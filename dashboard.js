const CONFIG = {
  ORCHESTRATORS_URL: 'orchestrators.json',
  PAGE_SIZE: 6
};

let orchestrators = [];
let allBuilds = [];
let filteredBuilds = [];
let currentPage = 1;
let selectedBuild = null;
let children = [];
let childrenPage = 1;
let activeOrchFilter = 'all';
let showingFailedOnly = false;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh').onclick = loadAll;
  document.getElementById('qa-refresh').onclick = loadAll;
  document.getElementById('build-search').oninput = applyFilters;
  document.getElementById('filter-orch').onchange = applyFilters;
  document.getElementById('orch-search').oninput = filterOrchList;

  // Click on FAILED number
  document.getElementById('stat-failed').style.cursor = 'pointer';
  document.getElementById('stat-failed').onclick = showFailedFilter;

  // Click on the red ring text / area
  document.getElementById('pct-failed').style.cursor = 'pointer';
  document.getElementById('pct-failed').onclick = showFailedFilter;

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
    showingFailedOnly = false;
    document.getElementById('detail-card').style.display = 'none';
    hideFailedBanner();

    renderOrchList();
    populateOrchFilter();
    updateStats();
    renderDonut();
    renderBars();
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

function showFailedFilter() {
  showingFailedOnly = true;
  filteredBuilds = allBuilds.filter(b => (b.failedCount || 0) > 0);
  currentPage = 1;

  showFailedBanner();
  document.getElementById('table-subtitle').textContent = 'Showing builds with failed jobs';
  document.getElementById('footer-info').textContent = `Showing ${filteredBuilds.length} of ${allBuilds.length} builds`;
  renderTable();

  // Auto-select the latest parent that has failures
  if (filteredBuilds.length > 0) {
    showDetails(filteredBuilds[0]);
  }
}

function clearFailedFilter() {
  showingFailedOnly = false;
  hideFailedBanner();
  applyFilters();
}

function showFailedBanner() {
  let banner = document.getElementById('failed-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'failed-banner';
    banner.style.cssText = `
      background:#fef2f2; border:1px solid #fecaca; color:#991b1b;
      padding:10px 16px; margin-bottom:12px; border-radius:8px;
      display:flex; align-items:center; justify-content:space-between;
      font-size:13px; font-weight:500;
    `;
    const tableCard = document.querySelector('.center-panel .card');
    tableCard.parentNode.insertBefore(banner, tableCard);
  }
  banner.innerHTML = `
    <span>Showing only builds that contain failed jobs</span>
    <button onclick="clearFailedFilter()" style="background:#991b1b;color:#fff;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px">
      Clear filter
    </button>
  `;
  banner.style.display = 'flex';
}

function hideFailedBanner() {
  const banner = document.getElementById('failed-banner');
  if (banner) banner.style.display = 'none';
}

/* ---------- Rest of the functions (same as before) ---------- */

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
      document.getElementById('filter-orch').value = o.id;
      showingFailedOnly = false;
      hideFailedBanner();
      applyFilters();
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
  const totalChildren = totalSuccessChildren + totalFailedChildren + totalUnstableChildren || 1;

  const lastSuccess = last24.reduce((s, b) => s + (b.successCount || 0), 0);
  const lastFailed  = last24.reduce((s, b) => s + (b.failedCount || 0), 0);
  const lastUnstable = last24.reduce((s, b) => s + (b.unstableCount || 0), 0);

  const prevSuccess = prev24.reduce((s, b) => s + (b.successCount || 0), 0);
  const prevFailed  = prev24.reduce((s, b) => s + (b.failedCount || 0), 0);
  const prevUnstable = prev24.reduce((s, b) => s + (b.unstableCount || 0), 0);

  document.getElementById('stat-total').textContent = totalParents;
  document.getElementById('stat-success').textContent = totalSuccessChildren;
  document.getElementById('stat-failed').textContent = totalFailedChildren;
  document.getElementById('stat-unstable').textContent = totalUnstableChildren;

  const pct = (n, t) => t ? Math.round((n / t) * 1000) / 10 : 0;
  const pctSuccess  = pct(totalSuccessChildren, totalChildren);
  const pctFailed   = pct(totalFailedChildren, totalChildren);
  const pctUnstable = pct(totalUnstableChildren, totalChildren);

  document.getElementById('pct-success').textContent  = pctSuccess + '%';
  document.getElementById('pct-failed').textContent   = pctFailed + '%';
  document.getElementById('pct-unstable').textContent = pctUnstable + '%';

  const circ = 113;
  setRing('ring-success',  circ - (pctSuccess  / 100) * circ);
  setRing('ring-failed',   circ - (pctFailed   / 100) * circ);
  setRing('ring-unstable', circ - (pctUnstable / 100) * circ);

  setTrend('trend-total',    last24.length - prev24.length);
  setTrend('trend-success',  lastSuccess - prevSuccess);
  setTrend('trend-failed',   lastFailed - prevFailed);
  setTrend('trend-unstable', lastUnstable - prevUnstable);

  renderMiniBars(last24.slice(0, 8).reverse());
}

function parseTimestamp(ts) {
  if (!ts || ts === '—') return null;
  const d = new Date(ts.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.getTime();
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
    bar.style.height = (8 + Math.random() * 18) + 'px';
    container.appendChild(bar);
  });
}

function renderDonut() {
  const success = allBuilds.reduce((s, b) => s + (b.successCount || 0), 0);
  const failed  = allBuilds.reduce((s, b) => s + (b.failedCount || 0), 0);
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
    <div class="legend-row"><span class="legend-dot" style="background:#10b981"></span> Success ${success} (${Math.round(success/total*100)}%)</div>
    <div class="legend-row" style="cursor:pointer" onclick="showFailedFilter()"><span class="legend-dot" style="background:#ef4444"></span> Failed ${failed} (${Math.round(failed/total*100)}%)</div>
    <div class="legend-row"><span class="legend-dot" style="background:#f59e0b"></span> Unstable ${unstable} (${Math.round(unstable/total*100)}%)</div>
  `;
}

function renderBars() {
  const container = document.getElementById('bars-chart');
  container.innerHTML = '';
  const recent = allBuilds.slice(0, 8).reverse();
  if (!recent.length) return;
  recent.forEach(b => {
    const status = (b.status || '').toUpperCase();
    const cls = status === 'SUCCESS' ? 'success' : (status === 'UNSTABLE' ? 'unstable' : 'failed');
    const h = 20 + Math.random() * 60;
    const group = document.createElement('div');
    group.className = 'bar-group';
    group.innerHTML = `<div class="bar ${cls}" style="height:${h}%"></div><div class="bar-label">#${b.build}</div>`;
    container.appendChild(group);
  });
}

function renderOrchStatus() {
  const el = document.getElementById('orch-status-list');
  el.innerHTML = '';
  orchestrators.forEach(o => {
    const builds = allBuilds.filter(b => b.orchestratorId === o.id);
    if (!builds.length) return;
    const success = builds.reduce((s, b) => s + (b.successCount || 0), 0);
    const failed  = builds.reduce((s, b) => s + (b.failedCount || 0), 0);
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
        <div class="seg success" style="width:${(success/total)*100}%"></div>
        <div class="seg failed" style="width:${(failed/total)*100}%"></div>
        <div class="seg unstable" style="width:${(unstable/total)*100}%"></div>
      </div>
    `;
    el.appendChild(row);
  });
}

function renderActivity() {
  const ul = document.getElementById('activity-list');
  ul.innerHTML = '';
  allBuilds.slice(0, 6).forEach(b => {
    const ok = (b.status || '').toUpperCase() === 'SUCCESS';
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="act-icon ${ok ? 'ok' : 'err'}">${ok ? '✓' : '✕'}</div>
      <div class="act-text">
        <div class="act-title">Build #${b.build} ${ok ? 'completed' : 'failed'}</div>
        <div class="act-sub">${b.orchestratorName} · ${b.timestamp || ''}</div>
      </div>
    `;
    ul.appendChild(li);
  });
}

function applyFilters() {
  if (showingFailedOnly) return; // keep failed filter active until cleared

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
      const cls = badgeClass(b.status);
      tr.innerHTML = `
        <td class="build-id">${b.build}</td>
        <td><div class="orch-cell"><span class="dot" style="background:${b.orchestratorColor}"></span>${b.orchestratorName}</div></td>
        <td>${b.timestamp || '—'}</td>
        <td>${b.endTime || '—'}</td>
        <td><span class="badge ${cls}">${b.status || '—'}</span></td>
        <td>${b.duration || '—'}</td>
        <td style="text-align:center">${b.children ?? '—'}</td>
        <td style="text-align:center;color:var(--green);font-weight:600">${b.successCount ?? 0}</td>
        <td style="text-align:center;color:var(--red);font-weight:600">${b.failedCount ?? 0}</td>
        <td style="text-align:center;color:var(--amber);font-weight:600">${b.unstableCount ?? 0}</td>
        <td><button class="link">View →</button></td>
      `;
      tbody.appendChild(tr);
    });
  }
  renderPager('builds-pager', filteredBuilds.length, currentPage, p => {
    currentPage = p;
    renderTable();
  });
}

function badgeClass(s) {
  if (!s) return 'badge-other';
  s = s.toUpperCase();
  if (s === 'SUCCESS') return 'badge-success';
  if (s === 'FAILED' || s === 'FAILURE') return 'badge-failed';
  if (s === 'UNSTABLE') return 'badge-unstable';
  return 'badge-other';
}

function renderPager(id, total, current, cb) {
  const pages = Math.max(1, Math.ceil(total / CONFIG.PAGE_SIZE));
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
    const url = `data/${b.folder}/Builds/${file}?t=${Date.now()}`;
    const res = await fetch(url);
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
      const isFailed = ['FAILED','FAILURE'].includes((c.status || '').toUpperCase());
      if (isFailed) tr.style.background = '#fef2f2';

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
        <td>${action}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderPager('children-pager', children.length, childrenPage, p => {
    childrenPage = p;
    renderChildren();
  });
}
