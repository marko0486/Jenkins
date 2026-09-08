const CONFIG = {
  ORCHESTRATORS_URL: 'orchestrators.json',
  PAGE_SIZE: 6,
  FAILED_PAGE_SIZE: 15,
  HISTORY_PAGE_SIZE: 15
};

let orchestrators = [];
let allBuilds = [];
let filteredBuilds = [];
let currentPage = 1;
let selectedBuild = null;
let children = [];
let childrenPage = 1;
let activeOrchFilter = 'all';

let failedJobs = [];
let filteredFailedJobs = [];
let failedPage = 1;
let bellCleared = false;
let isLoadingFailed = false;

let historyJobs = [];
let filteredHistoryJobs = [];
let historyPage = 1;
let isLoadingHistory = false;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh').onclick = loadAll;
  document.getElementById('qa-refresh').onclick = loadAll;
  document.getElementById('build-search').oninput = applyFilters;
  document.getElementById('filter-orch').onchange = applyFilters;
  document.getElementById('orch-search').oninput = filterOrchList;
  document.getElementById('btn-back-builds').onclick = closeFailedJobsView;
  document.getElementById('failed-stat-card').onclick = openFailedJobsView;
  document.getElementById('failed-search').oninput = filterFailedJobs;
  document.getElementById('btn-back-history').onclick = closeHistoryView;
  document.getElementById('history-search').oninput = filterHistoryJobs;

  document.getElementById('btn-bell').onclick = () => {
    bellCleared = true;
    updateBellBadge(0);
    openFailedJobsView();
  };

  document.getElementById('nav-dashboard').onclick = () => {
    setActiveNav('dashboard');
    showDashboardView();
  };
  document.getElementById('nav-failed').onclick = () => {
    setActiveNav('failed');
    openFailedJobsView();
  };
  document.getElementById('nav-history').onclick = () => {
    setActiveNav('history');
    openHistoryView();
  };
  document.getElementById('nav-reports').onclick = () => {
    alert('Reports – Coming soon');
  };

  document.querySelectorAll('.filter-tabs .tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.filter-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeOrchFilter = tab.dataset.filter;
      renderOrchList();
    };
  });

  loadAll();
});

function setActiveNav(view) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const map = {
    dashboard: 'nav-dashboard',
    failed: 'nav-failed',
    history: 'nav-history',
    reports: 'nav-reports'
  };
  const el = document.getElementById(map[view]);
  if (el) el.classList.add('active');
}

function showDashboardView() {
  document.getElementById('builds-card').style.display = 'block';
  document.getElementById('failed-jobs-card').style.display = 'none';
  document.getElementById('history-card').style.display = 'none';
  setActiveNav('dashboard');
  renderTable();
}

async function loadAll() {
  try {
    const res = await fetch(CONFIG.ORCHESTRATORS_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error('Cannot load orchestrators.json');
    orchestrators = await res.json();

    const results = await Promise.all(
      orchestrators.map(async o => {
        try {
          const r = await fetch(`data/${o.folder}/index.json?t=${Date.now()}`);
          if (!r.ok) return [];
          const data = await r.json();
          return data.map(b => ({
            ...b,
            orchestratorId: o.id,
            orchestratorName: o.displayName || o.name,
            orchestratorColor: o.color || '#3b82f6',
            folder: o.folder
          }));
        } catch {
          return [];
        }
      })
    );

    allBuilds = results.flat().sort((a, b) => Number(b.build) - Number(a.build));
    filteredBuilds = [...allBuilds];
    currentPage = 1;
    selectedBuild = null;
    children = [];
    document.getElementById('detail-card').style.display = 'none';

    showDashboardView();

    renderOrchList();
    populateOrchFilter();
    updateStats();
    renderDonut();
    renderOrchStatus();
    renderActivity();
    renderTable();

    const now = new Date().toLocaleString('en-GB');
    document.getElementById('last-updated').textContent = now;
    document.getElementById('footer-generated').textContent = 'Generated: ' + now;
    document.getElementById('footer-info').textContent = `Showing ${filteredBuilds.length} of ${allBuilds.length} builds`;
    document.getElementById('orch-count').textContent = orchestrators.length;
  } catch (err) {
    console.error(err);
    alert('Error loading dashboard:\n' + err.message);
  }
}

function parseTimestamp(ts) {
  if (!ts || ts === '—') return null;
  const d = new Date(ts.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.getTime();
}

function displayPath(p) {
  if (!p || p === '—' || p === 'null') return '—';
  let s = String(p);
  s = s.replace(/\\+/g, '\\');
  if (s.startsWith('\\')) s = '\\' + s;
  return s;
}

/* ========== FAILED JOBS ========== */
async function openFailedJobsView() {
  if (isLoadingFailed) return;
  isLoadingFailed = true;

  failedJobs = [];
  const seen = new Set();

  try {
    for (const parent of allBuilds) {
      if ((parent.failedCount || 0) === 0) continue;
      try {
        const file = parent.file || `Build_${parent.build}.json`;
        const url = `data/${parent.folder}/Builds/${file}?t=${Date.now()}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const kids = data.children || [];

        kids.forEach(c => {
          const status = (c.status || '').toUpperCase();
          if (status === 'FAILED' || status === 'FAILURE' || status === 'PRECHECK_FAILED') {
            const key = `${parent.build}||${c.job || ''}`;
            if (seen.has(key)) return;
            seen.add(key);

            let failTime = c.endTime && c.endTime !== '—' ? c.endTime
                         : c.startTime && c.startTime !== '—' ? c.startTime
                         : parent.endTime && parent.endTime !== '—' ? parent.endTime
                         : parent.timestamp || '—';

            failedJobs.push({
              job: c.job || '—',
              parentBuild: parent.build,
              orchestrator: parent.orchestratorName,
              orchestratorColor: parent.orchestratorColor,
              status: c.status,
              reason: c.reason || '—',
              startTime: failTime,
              logFile: c.logFile || null,
              _sortKey: parseTimestamp(failTime) || 0
            });
          }
        });
      } catch (e) {
        console.warn('Could not load children for build', parent.build, e);
      }
    }
  } finally {
    isLoadingFailed = false;
  }

  failedJobs.sort((a, b) => b._sortKey - a._sortKey);
  filteredFailedJobs = [...failedJobs];
  failedPage = 1;

  document.getElementById('builds-card').style.display = 'none';
  document.getElementById('detail-card').style.display = 'none';
  document.getElementById('history-card').style.display = 'none';
  document.getElementById('failed-jobs-card').style.display = 'block';
  document.getElementById('failed-search').value = '';

  document.getElementById('failed-jobs-subtitle').textContent =
    `${failedJobs.length} failed job${failedJobs.length !== 1 ? 's' : ''} found`;

  setActiveNav('failed');
  renderFailedJobs();
}

function closeFailedJobsView() {
  showDashboardView();
}

function filterFailedJobs() {
  const q = (document.getElementById('failed-search').value || '').toLowerCase().trim();
  if (!q) {
    filteredFailedJobs = [...failedJobs];
  } else {
    filteredFailedJobs = failedJobs.filter(f =>
      (f.job || '').toLowerCase().includes(q) ||
      String(f.parentBuild).includes(q) ||
      (f.orchestrator || '').toLowerCase().includes(q)
    );
  }
  failedPage = 1;
  document.getElementById('failed-jobs-subtitle').textContent =
    `${filteredFailedJobs.length} failed job${filteredFailedJobs.length !== 1 ? 's' : ''} found`;
  renderFailedJobs();
}

function renderFailedJobs() {
  const tbody = document.getElementById('failed-jobs-tbody');
  tbody.innerHTML = '';
  const start = (failedPage - 1) * CONFIG.FAILED_PAGE_SIZE;
  const page = filteredFailedJobs.slice(start, start + CONFIG.FAILED_PAGE_SIZE);

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">No failed jobs found</td></tr>`;
  } else {
    page.forEach(f => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'default';
      tr.innerHTML = `
        <td style="font-weight:500">${f.job}</td>
        <td class="build-id">#${f.parentBuild}</td>
        <td>
          <div class="orch-cell">
            <span class="dot" style="background:${f.orchestratorColor}"></span>
            ${f.orchestrator}
          </div>
        </td>
        <td><span class="badge badge-failed">${f.status}</span></td>
        <td style="color:#dc2626;max-width:260px;white-space:normal">${f.reason}</td>
        <td>${f.startTime}</td>
        <td>
          ${f.logFile
            ? `<button class="link" onclick="alert('Log: ${f.logFile}')">View Log</button>`
            : `<span style="color:#94a3b8;font-size:12px">No log</span>`}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderPagerCustom('failed-jobs-pager', filteredFailedJobs.length, failedPage, CONFIG.FAILED_PAGE_SIZE, p => {
    failedPage = p;
    renderFailedJobs();
  });
}

/* ========== JOB HISTORY ========== */
async function openHistoryView() {
  if (isLoadingHistory) return;
  isLoadingHistory = true;

  const map = new Map();

  try {
    for (const parent of allBuilds) {
      try {
        const file = parent.file || `Build_${parent.build}.json`;
        const url = `data/${parent.folder}/Builds/${file}?t=${Date.now()}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const kids = data.children || [];

        kids.forEach(c => {
          const name = (c.job || '').trim();
          if (!name || name === '—') return;

          let timeStr = c.endTime && c.endTime !== '—' ? c.endTime
                      : c.startTime && c.startTime !== '—' ? c.startTime
                      : parent.endTime && parent.endTime !== '—' ? parent.endTime
                      : parent.timestamp || '—';
          const timeKey = parseTimestamp(timeStr) || 0;

          const existing = map.get(name);
          if (!existing || timeKey >= existing._sortKey) {
            map.set(name, {
              job: name,
              source: c.source || '—',
              destination: c.destination || '—',
              transferType: c.transferType || '—',
              fileMask: c.fileMask || '—',
              flags: c.flags || '—',
              lastSeen: timeStr,
              _sortKey: timeKey
            });
          }
        });
      } catch (e) {
        console.warn('History load error for build', parent.build, e);
      }
    }
  } finally {
    isLoadingHistory = false;
  }

  historyJobs = Array.from(map.values()).sort((a, b) => b._sortKey - a._sortKey);
  filteredHistoryJobs = [...historyJobs];
  historyPage = 1;

  document.getElementById('builds-card').style.display = 'none';
  document.getElementById('failed-jobs-card').style.display = 'none';
  document.getElementById('detail-card').style.display = 'none';
  document.getElementById('history-card').style.display = 'block';
  document.getElementById('history-search').value = '';

  document.getElementById('history-subtitle').textContent =
    `${historyJobs.length} unique job${historyJobs.length !== 1 ? 's' : ''} found`;

  setActiveNav('history');
  renderHistoryJobs();
}

function closeHistoryView() {
  showDashboardView();
}

function filterHistoryJobs() {
  const q = (document.getElementById('history-search').value || '').toLowerCase().trim();
  if (!q) {
    filteredHistoryJobs = [...historyJobs];
  } else {
    filteredHistoryJobs = historyJobs.filter(h =>
      (h.job || '').toLowerCase().includes(q) ||
      (h.source || '').toLowerCase().includes(q) ||
      (h.destination || '').toLowerCase().includes(q) ||
      (h.transferType || '').toLowerCase().includes(q) ||
      (h.fileMask || '').toLowerCase().includes(q) ||
      (h.flags || '').toLowerCase().includes(q)
    );
  }
  historyPage = 1;
  document.getElementById('history-subtitle').textContent =
    `${filteredHistoryJobs.length} unique job${filteredHistoryJobs.length !== 1 ? 's' : ''} found`;
  renderHistoryJobs();
}

function renderHistoryJobs() {
  const tbody = document.getElementById('history-tbody');
  tbody.innerHTML = '';

  const start = (historyPage - 1) * CONFIG.HISTORY_PAGE_SIZE;
  const page = filteredHistoryJobs.slice(start, start + CONFIG.HISTORY_PAGE_SIZE);

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#94a3b8">No jobs found</td></tr>`;
  } else {
    page.forEach(h => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'default';
      tr.innerHTML = `
        <td style="font-weight:500">${h.job}</td>
        <td style="max-width:220px;white-space:normal;word-break:break-all">${displayPath(h.source)}</td>
        <td style="max-width:220px;white-space:normal;word-break:break-all">${displayPath(h.destination)}</td>
        <td>${h.transferType || '—'}</td>
        <td>${h.fileMask || '—'}</td>
        <td style="max-width:160px;white-space:normal">${h.flags || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderPagerCustom('history-pager', filteredHistoryJobs.length, historyPage, CONFIG.HISTORY_PAGE_SIZE, p => {
    historyPage = p;
    renderHistoryJobs();
  });
}

function updateBellBadge(count) {
  const badge = document.getElementById('bell-badge');
  if (count > 0 && !bellCleared) {
    badge.hidden = false;
    badge.textContent = count > 99 ? '99+' : count;
  } else {
    badge.hidden = true;
  }
}

/* ========== ORCHESTRATOR LIST ========== */
function renderOrchList() {
  const ul = document.getElementById('orch-list');
  ul.innerHTML = '';
  let list = [...orchestrators];
  const q = (document.getElementById('orch-search').value || '').toLowerCase();
  if (q) list = list.filter(o => (o.displayName || o.name).toLowerCase().includes(q));

  if (activeOrchFilter === 'active') {
    list = list.filter(o => {
      const builds = allBuilds.filter(b => b.orchestratorId === o.id);
      return builds.length && (builds[0].status || '').toUpperCase() === 'SUCCESS';
    });
  } else if (activeOrchFilter === 'issues') {
    list = list.filter(o => {
      const builds = allBuilds.filter(b => b.orchestratorId === o.id);
      return builds.some(b => (b.failedCount || 0) > 0 || ['FAILED','FAILURE','UNSTABLE'].includes((b.status || '').toUpperCase()));
    });
  }

  list.forEach(o => {
    const builds = allBuilds.filter(b => b.orchestratorId === o.id);
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="orch-info">
        <span class="orch-dot" style="background:${o.color || '#3b82f6'}"></span>
        <span class="orch-name">${o.displayName || o.name}</span>
      </div>
      <span class="orch-meta">${builds.length} builds</span>
    `;
    li.onclick = () => {
      showDashboardView();
      document.getElementById('filter-orch').value = o.id;
      applyFilters();
      selectedBuild = null;
      children = [];
      document.getElementById('detail-card').style.display = 'none';
      const latest = allBuilds.find(b => b.orchestratorId === o.id);
      if (latest) showDetails(latest);
    };
    ul.appendChild(li);
  });
}

function filterOrchList() { renderOrchList(); }

function populateOrchFilter() {
  const sel = document.getElementById('filter-orch');
  sel.innerHTML = '<option value="all">All Orchestrators</option>';
  orchestrators.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.displayName || o.name;
    sel.appendChild(opt);
  });
}

/* ========== STATS ========== */
function updateStats() {
  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;

  const last24 = allBuilds.filter(b => {
    const t = parseTimestamp(b.timestamp);
    return t && (now - t) <= h24;
  });
  const prev24 = allBuilds.filter(b => {
    const t = parseTimestamp(b.timestamp);
    return t && (now - t) > h24 && (now - t) <= h24 * 2;
  });

  const totalParents = allBuilds.length;
  const totalSuccessChildren = allBuilds.reduce((sum, b) => sum + (b.successCount || 0), 0);
  const totalFailedChildren  = allBuilds.reduce((sum, b) => sum + (b.failedCount || 0), 0);
  const totalUnstableChildren = allBuilds.reduce((sum, b) => sum + (b.unstableCount || 0), 0);
  const totalChildren = totalSuccessChildren + totalFailedChildren + 
