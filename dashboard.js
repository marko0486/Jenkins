const CONFIG = {
  ORCHESTRATORS_URL: 'orchestrators.json',
  SCHEDULED_URL: 'scheduled-jobs.json',
  PAGE_SIZE: 6,
  FAILED_PAGE_SIZE: 15,
  HISTORY_PAGE_SIZE: 15,
  SCHEDULED_PAGE_SIZE: 10
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
let historyCache = null;

let scheduledJobs = [];
let filteredScheduled = [];
let scheduledPage = 1;
let selectedScheduled = null;
let isLoadingScheduled = false;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh').onclick = loadAll;
  document.getElementById('qa-refresh').onclick = loadAll;
  document.getElementById('qa-sched-refresh').onclick = () => openScheduledView(true);

  document.getElementById('build-search').oninput = applyFilters;
  document.getElementById('filter-orch').onchange = applyFilters;
  document.getElementById('orch-search').oninput = filterOrchList;
  document.getElementById('btn-back-builds').onclick = closeFailedJobsView;
  document.getElementById('failed-stat-card').onclick = openFailedJobsView;
  document.getElementById('failed-search').oninput = filterFailedJobs;
  document.getElementById('btn-back-history').onclick = closeHistoryView;
  document.getElementById('history-search').oninput = filterHistoryJobs;
  document.getElementById('scheduled-search').oninput = filterScheduled;
  document.getElementById('scheduled-filter-type').onchange = filterScheduled;

  document.getElementById('btn-bell').onclick = () => {
    bellCleared = true;
    updateBellBadge(0);
    openFailedJobsView();
  };

  document.getElementById('nav-dashboard').onclick = () => { setActiveNav('dashboard'); showDashboardView(); };
  document.getElementById('nav-failed').onclick = () => { setActiveNav('failed'); openFailedJobsView(); };
  document.getElementById('nav-history').onclick = () => { setActiveNav('history'); openHistoryView(); };
  document.getElementById('nav-scheduled').onclick = () => { setActiveNav('scheduled'); openScheduledView(); };
  document.getElementById('nav-reports').onclick = () => alert('Reports – Coming soon');

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
    scheduled: 'nav-scheduled',
    reports: 'nav-reports'
  };
  const el = document.getElementById(map[view]);
  if (el) el.classList.add('active');
}

function hideAllCenterCards() {
  document.getElementById('builds-card').style.display = 'none';
  document.getElementById('failed-jobs-card').style.display = 'none';
  document.getElementById('history-card').style.display = 'none';
  document.getElementById('scheduled-view').style.display = 'none';
  document.getElementById('detail-card').style.display = 'none';
  const schedDetail = document.getElementById('scheduled-detail-card');
  if (schedDetail) schedDetail.style.display = 'none';
}

function showDashboardView() {
  hideAllCenterCards();
  document.getElementById('stats-row').style.display = 'grid';
  document.getElementById('builds-card').style.display = 'block';
  document.getElementById('right-dashboard').style.display = 'block';
  document.getElementById('right-scheduled').style.display = 'none';
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
    historyCache = null;
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
  let s = String(p).replace(/\\+/g, '\\');
  if (s.startsWith('\\')) s = '\\' + s;
  return s;
}

function badgeClass(s) {
  if (!s) return 'badge-other';
  s = String(s).toUpperCase();
  if (s === 'SUCCESS') return 'badge-success';
  if (s === 'FAILED' || s === 'FAILURE') return 'badge-failed';
  if (s === 'UNSTABLE') return 'badge-unstable';
  return 'badge-other';
}

function scheduleTypeBadge(t) {
  const v = (t || '').toLowerCase();
  if (v === 'daily') return 'badge-daily';
  if (v === 'weekly') return 'badge-weekly';
  if (v === 'monthly') return 'badge-monthly';
  return 'badge-other';
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
        const res = await fetch(`data/${parent.folder}/Builds/${file}?t=${Date.now()}`);
        if (!res.ok) continue;
        const data = await res.json();
        (data.children || []).forEach(c => {
          const status = (c.status || '').toUpperCase();
          if (!['FAILED', 'FAILURE', 'PRECHECK_FAILED'].includes(status)) return;
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
        });
      } catch (e) {
        console.warn(e);
      }
    }
  } finally {
    isLoadingFailed = false;
  }

  failedJobs.sort((a, b) => b._sortKey - a._sortKey);
  filteredFailedJobs = [...failedJobs];
  failedPage = 1;

  hideAllCenterCards();
  document.getElementById('stats-row').style.display = 'none';
  document.getElementById('right-dashboard').style.display = 'block';
  document.getElementById('right-scheduled').style.display = 'none';
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
  filteredFailedJobs = !q
    ? [...failedJobs]
    : failedJobs.filter(f =>
        (f.job || '').toLowerCase().includes(q) ||
        String(f.parentBuild).includes(q) ||
        (f.orchestrator || '').toLowerCase().includes(q)
      );
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
        <td><div class="orch-cell"><span class="dot" style="background:${f.orchestratorColor}"></span>${f.orchestrator}</div></td>
        <td><span class="badge badge-failed">${f.status}</span></td>
        <td style="color:#dc2626;max-width:260px;white-space:normal">${f.reason}</td>
        <td>${f.startTime}</td>
        <td>${f.logFile
          ? `<button class="link" onclick="alert('Log: ${f.logFile}')">View Log</button>`
          : `<span style="color:#94a3b8;font-size:12px">No log</span>`}</td>`;
      tbody.appendChild(tr);
    });
  }
  renderPagerCustom('failed-jobs-pager', filteredFailedJobs.length, failedPage, CONFIG.FAILED_PAGE_SIZE, p => {
    failedPage = p;
    renderFailedJobs();
  });
}

/* ========== JOB HISTORY (jobs-catalog.json – 1 request per orchestrator) ========== */
async function openHistoryView() {
  if (isLoadingHistory) return;
  isLoadingHistory = true;

  try {
    if (historyCache) {
      historyJobs = historyCache;
      filteredHistoryJobs = [...historyJobs];
      historyPage = 1;
      showHistoryUI();
      return;
    }

    const results = await Promise.all(
      orchestrators.map(async o => {
        try {
          const res = await fetch(`data/${o.folder}/jobs-catalog.json?t=${Date.now()}`);
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data) ? data : [];
        } catch {
          return [];
        }
      })
    );

    const map = new Map();
    results.flat().forEach(e => {
      const name = (e.job || '').trim();
      if (!name) return;
      const timeKey = parseTimestamp(e.lastSeen) || 0;
      const existing = map.get(name);
      if (!existing || timeKey >= existing._sortKey) {
        map.set(name, {
          job: name,
          source: e.source || '—',
          destination: e.destination || '—',
          transferType: e.transferType || '—',
          fileMask: e.fileMask || '—',
          flags: e.flags || '—',
          _sortKey: timeKey
        });
      }
    });

    historyJobs = Array.from(map.values()).sort((a, b) => b._sortKey - a._sortKey);
    historyCache = historyJobs;
    filteredHistoryJobs = [...historyJobs];
    historyPage = 1;
    showHistoryUI();
  } finally {
    isLoadingHistory = false;
  }
}

function showHistoryUI() {
  hideAllCenterCards();
  document.getElementById('stats-row').style.display = 'none';
  document.getElementById('right-dashboard').style.display = 'block';
  document.getElementById('right-scheduled').style.display = 'none';
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
  filteredHistoryJobs = !q
    ? [...historyJobs]
    : historyJobs.filter(h =>
        (h.job || '').toLowerCase().includes(q) ||
        (h.source || '').toLowerCase().includes(q) ||
        (h.destination || '').toLowerCase().includes(q) ||
        (h.transferType || '').toLowerCase().includes(q) ||
        (h.fileMask || '').toLowerCase().includes(q) ||
        (h.flags || '').toLowerCase().includes(q)
      );
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
        <td style="max-width:160px;white-space:normal">${h.flags || '—'}</td>`;
      tbody.appendChild(tr);
    });
  }
  renderPagerCustom('history-pager', filteredHistoryJobs.length, historyPage, CONFIG.HISTORY_PAGE_SIZE, p => {
    historyPage = p;
    renderHistoryJobs();
  });
}

/* ========== SCHEDULED JOBS ========== */
async function openScheduledView(forceReload) {
  if (isLoadingScheduled && !forceReload) return;
  isLoadingScheduled = true;

  try {
    const res = await fetch(CONFIG.SCHEDULED_URL + '?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      scheduledJobs = Array.isArray(data) ? data : [];
    } else {
      scheduledJobs = [];
    }

    await Promise.all(
      scheduledJobs.map(async job => {
        try {
          const folder = job.folder || job.job;
          const r = await fetch(`data/scheduled/${encodeURIComponent(folder)}/history.json?t=${Date.now()}`);
          if (!r.ok) {
            job._history = [];
            return;
          }
          const hist = await r.json();
          job._history = Array.isArray(hist) ? hist : [];
          if (job._history.length) {
            const last = job._history[0];
            job.lastRun = last.startTime || last.endTime || job.lastRun || '—';
            job.lastStatus = last.status || job.lastStatus || '—';
          }
        } catch {
          job._history = [];
        }
      })
    );
  } catch (e) {
    console.warn('scheduled-jobs.json not found yet', e);
    scheduledJobs = [];
  } finally {
    isLoadingScheduled = false;
  }

  filteredScheduled = [...scheduledJobs];
  scheduledPage = 1;
  selectedScheduled = null;

  hideAllCenterCards();
  document.getElementById('stats-row').style.display = 'none';
  document.getElementById('right-dashboard').style.display = 'none';
  document.getElementById('right-scheduled').style.display = 'block';
  document.getElementById('scheduled-view').style.display = 'block';
  const schedDetail = document.getElementById('scheduled-detail-card');
  if (schedDetail) schedDetail.style.display = 'none';
  document.getElementById('scheduled-search').value = '';
  document.getElementById('scheduled-filter-type').value = 'all';

  document.getElementById('scheduled-subtitle').textContent = scheduledJobs.length
    ? `${scheduledJobs.length} scheduled job${scheduledJobs.length !== 1 ? 's' : ''}`
    : 'No scheduled-jobs.json found yet — add the file to populate this view';

  setActiveNav('scheduled');
  renderScheduledTable();
  renderScheduleSummary();
  renderNextRuns();
  document.getElementById('footer-info').textContent = `Showing ${scheduledJobs.length} scheduled jobs`;
}

function filterScheduled() {
  const q = (document.getElementById('scheduled-search').value || '').toLowerCase().trim();
  const type = document.getElementById('scheduled-filter-type').value;
  filteredScheduled = scheduledJobs.filter(j => {
    if (type !== 'all' && (j.scheduleType || '') !== type) return false;
    if (q && !(j.job || '').toLowerCase().includes(q)) return false;
    return true;
  });
  scheduledPage = 1;
  renderScheduledTable();
}

function renderScheduledTable() {
  const tbody = document.getElementById('scheduled-tbody');
  tbody.innerHTML = '';
  const start = (scheduledPage - 1) * CONFIG.SCHEDULED_PAGE_SIZE;
  const page = filteredScheduled.slice(start, start + CONFIG.SCHEDULED_PAGE_SIZE);

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#94a3b8">No scheduled jobs found</td></tr>`;
  } else {
    page.forEach(j => {
      const tr = document.createElement('tr');
      if (selectedScheduled && selectedScheduled.job === j.job) tr.classList.add('selected');
      tr.onclick = () => showScheduledDetails(j);
      tr.innerHTML = `
        <td style="font-weight:500">${j.job || '—'}</td>
        <td><span class="badge ${scheduleTypeBadge(j.scheduleType)}">${j.scheduleType || '—'}</span></td>
        <td>${j.schedule || '—'}</td>
        <td>${j.nextRun || '—'}</td>
        <td>${j.lastRun || '—'}</td>
        <td><span class="badge ${badgeClass(j.lastStatus)}">${j.lastStatus || '—'}</span></td>`;
      tbody.appendChild(tr);
    });
  }

  renderPagerCustom('scheduled-pager', filteredScheduled.length, scheduledPage, CONFIG.SCHEDULED_PAGE_SIZE, p => {
    scheduledPage = p;
    renderScheduledTable();
  });
}

function showScheduledDetails(j) {
  selectedScheduled = j;
  renderScheduledTable();
  document.getElementById('scheduled-detail-card').style.display = 'block';
  document.getElementById('sched-detail-name').textContent = j.job || '—';
  document.getElementById('sched-detail-schedule').textContent =
    `${j.scheduleType || '—'} at ${j.schedule || '—'}`;
  document.getElementById('sched-detail-tz').textContent =
    j.timezone ? `Time zone: ${j.timezone}` : '—';
  document.getElementById('sched-detail-next').textContent = j.nextRun || '—';
  document.getElementById('sched-detail-last').textContent = j.lastRun || '—';
  document.getElementById('sched-detail-last-status').innerHTML = j.lastStatus
    ? `<span class="badge ${badgeClass(j.lastStatus)}" style="margin-top:4px;display:inline-block">${j.lastStatus}</span>`
    : '';

  const hist = (j._history || []).slice(0, 10);
  const tbody = document.getElementById('sched-history-tbody');
  tbody.innerHTML = '';
  if (!hist.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#94a3b8">No execution history yet</td></tr>`;
  } else {
    hist.forEach((h, idx) => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'default';
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td class="build-id">#${h.build ?? '—'}</td>
        <td>${h.startTime || '—'}</td>
        <td>${h.endTime || '—'}</td>
        <td>${h.duration || '—'}</td>
        <td><span class="badge ${badgeClass(h.status)}">${h.status || '—'}</span></td>
        <td>${h.logFile || '—'}</td>`;
      tbody.appendChild(tr);
    });
  }
}

function renderScheduleSummary() {
  const counts = { Daily: 0, Weekly: 0, Monthly: 0 };
  scheduledJobs.forEach(j => {
    const t = j.scheduleType || '';
    if (counts[t] !== undefined) counts[t]++;
  });
  const total = scheduledJobs.length || 1;
  document.getElementById('sched-donut-total').textContent = scheduledJobs.length;

  const segs = [
    { val: counts.Daily, color: '#2563eb' },
    { val: counts.Weekly, color: '#8b5cf6' },
    { val: counts.Monthly, color: '#f59e0b' }
  ];
  const r = 48, cx = 60, cy = 60, circ = 2 * Math.PI * r;
  let offset = 0, svg = '';
  segs.forEach(s => {
    const len = (s.val / total) * circ;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="14"
              stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}"
              transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += len;
  });
  document.getElementById('sched-donut').innerHTML = svg;

  const pct = n => (scheduledJobs.length ? Math.round((n / scheduledJobs.length) * 100) : 0);
  document.getElementById('sched-legend').innerHTML = `
    <div class="legend-row"><span class="legend-dot" style="background:#2563eb"></span> Daily ${counts.Daily} (${pct(counts.Daily)}%)</div>
    <div class="legend-row"><span class="legend-dot" style="background:#8b5cf6"></span> Weekly ${counts.Weekly} (${pct(counts.Weekly)}%)</div>
    <div class="legend-row"><span class="legend-dot" style="background:#f59e0b"></span> Monthly ${counts.Monthly} (${pct(counts.Monthly)}%)</div>`;
}

function renderNextRuns() {
  const ul = document.getElementById('next-runs-list');
  ul.innerHTML = '';
  const list = [...scheduledJobs].filter(j => j.nextRun && j.nextRun !== '—').slice(0, 6);
  if (!list.length) {
    ul.innerHTML = `<li style="color:#94a3b8;font-size:12px;padding:12px 0">No upcoming runs defined</li>`;
    return;
  }
  list.forEach(j => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="next-run-left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        <div>
          <div class="next-run-name" title="${j.job}">${j.job}</div>
          <div class="next-run-when">${j.nextRun}</div>
        </div>
      </div>
      <span class="next-run-badge">${j.scheduleType || ''}</span>`;
    ul.appendChild(li);
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

/* ========== ORCHESTRATORS / STATS / TABLE ========== */
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
      return builds.some(b =>
        (b.failedCount || 0) > 0 ||
        ['FAILED', 'FAILURE', 'UNSTABLE'].includes((b.status || '').toUpperCase())
      );
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
      <span class="orch-meta">${builds.length} builds</span>`;
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

function filterOrchList() {
  renderOrchList();
}

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

function updateStats() {
  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;
  const last24 = allBuilds.filter(b => {
    const t = parseTimestamp(b.timestamp);
    return t && now - t <= h24;
  });
  const prev24 = allBuilds.filter(b => {
    const t = parseTimestamp(b.timestamp);
    return t && now - t > h24 && now - t <= h24 * 2;
  });

  const totalParents = allBuilds.length;
  const totalSuccessChildren = allBuilds.reduce((s, b) => s + (b.successCount || 0), 0);
  const totalFailedChildren = allBuilds.reduce((s, b) => s + (b.failedCount || 0), 0);
  const totalUnstableChildren = allBuilds.reduce((s, b) => s + (b.unstableCount || 0), 0);
  const totalChildren = totalSuccessChildren + totalFailedChildren + totalUnstableChildren || 1;

  const failedLast24h = last24.reduce((s, b) => s + (b.failedCount || 0), 0);
  if (failedLast24h > 0) updateBellBadge(failedLast24h);
  else {
    updateBellBadge(0);
    bellCleared = false;
  }

  document.getElementById('stat-total').textContent = totalParents;
  document.getElementById('stat-success').textContent = totalSuccessChildren;
  document.getElementById('stat-failed').textContent = totalFailedChildren;
  document.getElementById('stat-unstable').textContent = totalUnstableChildren;

  const pct = (n, t) => (t ? Math.round((n / t) * 1000) / 10 : 0);
  const pctSuccess = pct(totalSuccessChildren, totalChildren);
  const pctFailed = pct(totalFailedChildren, totalChildren);
  const pctUnstable = pct(totalUnstableChildren, totalChildren);
  document.getElementById('pct-success').textContent = pctSuccess + '%';
  document.getElementById('pct-failed').textContent = pctFailed + '%';
  document.getElementById('pct-unstable').textContent = pctUnstable + '%';

  const circ = 113;
  setRing('ring-success', circ - (pctSuccess / 100) * circ);
  setRing('ring-failed', circ - (pctFailed / 100) * circ);
  setRing('ring-unstable', circ - (pctUnstable / 100) * circ);

  setTrend('trend-total', last24.length - prev24.length);
  setTrend(
    'trend-success',
    last24.reduce((s, b) => s + (b.successCount || 0), 0) - prev24.reduce((s, b) => s + (b.successCount || 0), 0)
  );
  setTrend(
    'trend-failed',
    last24.reduce((s, b) => s + (b.failedCount || 0), 0) - prev24.reduce((s, b) => s + (b.failedCount || 0), 0)
  );
  setTrend(
    'trend-unstable',
    last24.reduce((s, b) => s + (b.unstableCount || 0), 0) - prev24.reduce((s, b) => s + (b.unstableCount || 0), 0)
  );
  renderMiniBars(last24.slice(0, 8).reverse());
}

function setRing(id, offset) {
  const el = document.getElementById(id);
  if (el) el.style.strokeDashoffset = offset;
}

function setTrend(id, diff) {
  const el = document.getElementById(id);
  if (!el) return;
  if (diff > 0) {
    el.className = 'stat-trend up';
    el.innerHTML = `↑ +${diff} <span style="color:#94a3b8">vs. last 24h</span>`;
  } else if (diff < 0) {
    el.className = 'stat-trend down';
    el.innerHTML = `↓ ${diff} <span style="color:#94a3b8">vs. last 24h</span>`;
  } else {
    el.className = 'stat-trend same';
    el.innerHTML = `— No change`;
  }
}

function renderMiniBars(builds) {
  const container = document.getElementById('mini-bars');
  if (!container) return;
  container.innerHTML = '';
  if (!builds.length) {
    for (let i = 0; i < 6; i++) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = '4px';
      container.appendChild(bar);
    }
    return;
  }
  builds.forEach(() => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = 8 + Math.random() * 18 + 'px';
    container.appendChild(bar);
  });
}

function renderDonut() {
  const success = allBuilds.reduce((s, b) => s + (b.successCount || 0), 0);
  const failed = allBuilds.reduce((s, b) => s + (b.failedCount || 0), 0);
  const unstable = allBuilds.reduce((s, b) => s + (b.unstableCount || 0), 0);
  const total = success + failed + unstable || 1;
  document.getElementById('donut-total').textContent = success + failed + unstable;
  const r = 48, cx = 60, cy = 60, circ = 2 * Math.PI * r;
  const segs = [
    { val: success, color: '#10b981' },
    { val: failed, color: '#ef4444' },
    { val: unstable, color: '#f59e0b' }
  ];
  let offset = 0, svg = '';
  segs.forEach(s => {
    const len = (s.val / total) * circ;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="14"
              stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}"
              transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += len;
  });
  document.getElementById('donut-chart').innerHTML = svg;
  document.getElementById('status-legend').innerHTML = `
    <div class="legend-row"><span class="legend-dot" style="background:#10b981"></span> Success ${success} (${Math.round((success / total) * 100)}%)</div>
    <div class="legend-row" style="cursor:pointer" onclick="openFailedJobsView()">
      <span class="legend-dot" style="background:#ef4444"></span> Failed ${failed} (${Math.round((failed / total) * 100)}%)
    </div>
    <div class="legend-row"><span class="legend-dot" style="background:#f59e0b"></span> Unstable ${unstable} (${Math.round((unstable / total) * 100)}%)</div>`;
}

function renderOrchStatus() {
  const el = document.getElementById('orch-status-list');
  el.innerHTML = '';
  orchestrators.forEach(o => {
    const builds = allBuilds.filter(b => b.orchestratorId === o.id);
    if (!builds.length) return;
    const success = builds.reduce((s, b) => s + (b.successCount || 0), 0);
    const failed = builds.reduce((s, b) => s + (b.failedCount || 0), 0);
    const unstable = builds.reduce((s, b) => s + (b.unstableCount || 0), 0);
    const total = success + failed + unstable || 1;
    const row = document.createElement('div');
    row.className = 'orch-status-row';
    row.innerHTML = `
      <div class="orch-status-name">
        <div class="left"><span class="orch-dot" style="background:${o.color || '#3b82f6'}"></span>${o.displayName || o.name}</div>
        <span>${success}/${total}</span>
      </div>
      <div class="orch-status-bar">
        <div class="seg success" style="width:${(success / total) * 100}%"></div>
        <div class="seg failed" style="width:${(failed / total) * 100}%"></div>
        <div class="seg unstable" style="width:${(unstable / total) * 100}%"></div>
      </div>`;
    el.appendChild(row);
  });
}

function renderActivity() {
  const ul = document.getElementById('activity-list');
  ul.innerHTML = '';
  allBuilds.slice(0, 5).forEach(b => {
    const ok = (b.status || '').toUpperCase() === 'SUCCESS';
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="act-icon ${ok ? 'ok' : 'err'}">${ok ? '✓' : '✕'}</div>
      <div class="act-text">
        <div class="act-title">Build #${b.build} ${ok ? 'completed' : 'failed'}</div>
        <div class="act-sub">${b.orchestratorName} · ${b.timestamp || ''}</div>
      </div>`;
    ul.appendChild(li);
  });
}

function applyFilters() {
  const orch = document.getElementById('filter-orch').value;
  const q = (document.getElementById('build-search').value || '').toLowerCase();
  filteredBuilds = allBuilds.filter(b => {
    if (orch !== 'all' && b.orchestratorId !== orch) return false;
    if (q && !String(b.build).includes(q) && !(b.orchestratorName || '').toLowerCase().includes(q)) return false;
    return true;
  });
  currentPage = 1;
  document.getElementById('table-subtitle').textContent =
    orch === 'all' ? 'Showing builds from all orchestrators' : 'Filtered by orchestrator';
  document.getElementById('footer-info').textContent = `Showing ${filteredBuilds.length} of ${allBuilds.length} builds`;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('builds-tbody');
  tbody.innerHTML = '';
  const start = (currentPage - 1) * CONFIG.PAGE_SIZE;
  const rows = filteredBuilds.slice(start, start + CONFIG.PAGE_SIZE);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:#94a3b8">No builds found</td></tr>`;
  } else {
    rows.forEach(b => {
      const tr = document.createElement('tr');
      if (selectedBuild && selectedBuild.build === b.build && selectedBuild.orchestratorId === b.orchestratorId) {
        tr.classList.add('selected');
      }
      tr.onclick = () => showDetails(b);
      tr.innerHTML = `
        <td class="build-id">${b.build}</td>
        <td><div class="orch-cell"><span class="dot" style="background:${b.orchestratorColor}"></span>${b.orchestratorName}</div></td>
        <td>${b.timestamp || '—'}</td>
        <td>${b.endTime || '—'}</td>
        <td><span class="badge ${badgeClass(b.status)}">${b.status || '—'}</span></td>
        <td>${b.duration || '—'}</td>
        <td style="text-align:center">${b.children ?? '—'}</td>
        <td style="text-align:center;color:var(--green);font-weight:600">${b.successCount ?? 0}</td>
        <td style="text-align:center;color:var(--red);font-weight:600">${b.failedCount ?? 0}</td>
        <td style="text-align:center;color:var(--amber);font-weight:600">${b.unstableCount ?? 0}</td>
        <td><button class="link">View →</button></td>`;
      tbody.appendChild(tr);
    });
  }
  renderPager('builds-pager', filteredBuilds.length, currentPage, p => {
    currentPage = p;
    renderTable();
  });
}

function renderPager(id, total, current, cb) {
  renderPagerCustom(id, total, current, CONFIG.PAGE_SIZE, cb);
}

function renderPagerCustom(id, total, current, pageSize, cb) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  const prev = document.createElement('button');
  prev.className = 'page-btn';
  prev.textContent = '‹';
  prev.disabled = current === 1;
  prev.onclick = () => cb(current - 1);
  el.appendChild(prev);
  for (let i = 1; i <= pages; i++) {
    const b = document.createElement('button');
    b.className = 'page-btn' + (i === current ? ' active' : '');
    b.textContent = i;
    b.onclick = () => cb(i);
    el.appendChild(b);
  }
  const next = document.createElement('button');
  next.className = 'page-btn';
  next.textContent = '›';
  next.disabled = current === pages;
  next.onclick = () => cb(current + 1);
  el.appendChild(next);
}

async function showDetails(b) {
  selectedBuild = b;
  childrenPage = 1;
  document.getElementById('detail-card').style.display = 'block';
  document.getElementById('detail-id').textContent = '#' + b.build;
  document.getElementById('detail-range').textContent =
    `${b.timestamp || '—'} → ${b.endTime || '—'} (${b.duration || '—'})`;
  const badge = document.getElementById('detail-badge');
  badge.textContent = b.status || '—';
  badge.className = 'badge ' + badgeClass(b.status);
  renderTable();
  try {
    const file = b.file || `Build_${b.build}.json`;
    const res = await fetch(`data/${b.folder}/Builds/${file}?t=${Date.now()}`);
    if (!res.ok) throw new Error('Cannot load build details');
    const data = await res.json();
    children = data.children || [];
    renderChildren();
  } catch (e) {
    document.getElementById('children-tbody').innerHTML =
      `<tr><td colspan="8" style="text-align:center;padding:30px;color:#dc2626">${e.message}</td></tr>`;
  }
}

function renderChildren() {
  const tbody = document.getElementById('children-tbody');
  tbody.innerHTML = '';
  const start = (childrenPage - 1) * CONFIG.PAGE_SIZE;
  const page = children.slice(start, start + CONFIG.PAGE_SIZE);
  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#94a3b8">No child builds</td></tr>`;
  } else {
    page.forEach(c => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'default';
      if (['FAILED', 'FAILURE'].includes((c.status || '').toUpperCase())) tr.style.background = '#fef2f2';
      const hasBuild = c.build != null && c.build !== '';
      let logCell = '—', action = '—';
      if (c.logFile) {
        logCell = `<span style="font-size:11px;color:#64748b">${c.logFile}</span>`;
        action = `<button class="link" onclick="event.stopPropagation();alert('Log: ${c.logFile}')">View</button>`;
      } else if (c.reason) {
        logCell = `<span style="font-size:11px;color:#dc2626">${c.reason}</span>`;
        action = `<span style="font-size:11px;color:#94a3b8">No log</span>`;
      }
      tr.innerHTML = `
        <td style="font-weight:500">${c.job || '—'}</td>
        <td class="build-id">${hasBuild ? c.build : '—'}</td>
        <td>${c.startTime || '—'}</td>
        <td>${c.endTime || '—'}</td>
        <td><span class="badge ${badgeClass(c.status)}">${c.status || '—'}</span></td>
        <td>${c.duration || '—'}</td>
        <td>${logCell}</td>
        <td>${action}</td>`;
      tbody.appendChild(tr);
    });
  }
  renderPager('children-pager', children.length, childrenPage, p => {
    childrenPage = p;
    renderChildren();
  });
}
