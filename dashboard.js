const CONFIG = {
  ORCHESTRATORS_URL: 'orchestrators.json',
  PAGE_SIZE: 8
};

let orchestrators = [];
let currentOrch = null;
let allParents = [];
let filtered = [];
let page = 1;
let selected = null;
let children = [];
let childPage = 1;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh').onclick = () => {
    if (currentOrch) loadOrch(currentOrch);
    else loadList();
  };
  document.getElementById('build-search').oninput = onSearch;
  loadList();
});

async function loadList() {
  try {
    const res = await fetch(CONFIG.ORCHESTRATORS_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error('Cannot load orchestrators.json');
    orchestrators = await res.json();
    renderList();
    if (orchestrators.length) selectOrch(orchestrators[0]);
  } catch (e) {
    console.error(e);
    document.getElementById('orchestrator-list').innerHTML =
      `<li style="color:#f87171;padding:12px">Error loading list</li>`;
  }
}

function renderList() {
  const ul = document.getElementById('orchestrator-list');
  ul.innerHTML = '';
  orchestrators.forEach(o => {
    const li = document.createElement('li');
    li.dataset.id = o.id;
    if (currentOrch && currentOrch.id === o.id) li.classList.add('active');
    li.innerHTML = `
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.displayName || o.name}</span>
      <span class="dot" id="dot-${o.id}"></span>
    `;
    li.onclick = () => selectOrch(o);
    ul.appendChild(li);
  });
}

function selectOrch(o) {
  currentOrch = o;
  selected = null;
  document.getElementById('detail-section').style.display = 'none';

  document.querySelectorAll('.orch-list li').forEach(li => {
    li.classList.toggle('active', li.dataset.id === o.id);
  });

  document.getElementById('page-title').textContent = o.displayName || o.name;
  loadOrch(o);
}

async function loadOrch(o) {
  try {
    const url = `data/${o.folder}/index.json?t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('No index.json found');
    allParents = await res.json();
    allParents.sort((a, b) => Number(b.build) - Number(a.build));
    filtered = [...allParents];
    page = 1;
    updateStats();
    renderTable();
    updateDot(o);
    const now = new Date().toLocaleString('en-GB');
    document.getElementById('last-updated').textContent = now;
    document.getElementById('sidebar-updated').textContent = 'Last Updated: ' + now;
  } catch (e) {
    console.error(e);
    allParents = [];
    filtered = [];
    updateStats();
    document.getElementById('parent-tbody').innerHTML =
      `<tr><td colspan="10" style="text-align:center;padding:40px;color:#94a3b8">No data for this orchestrator</td></tr>`;
  }
}

function updateDot(o) {
  const el = document.getElementById('dot-' + o.id);
  if (!el) return;
  if (!allParents.length) {
    el.className = 'dot';
    return;
  }
  const last = allParents[0];
  el.className = 'dot ' + ((last.status || '').toUpperCase() === 'SUCCESS' ? 'ok' : 'err');
}

function updateStats() {
  document.getElementById('stat-total').textContent = allParents.length;
  document.getElementById('stat-success').textContent =
    allParents.filter(p => (p.status || '').toUpperCase() === 'SUCCESS').length;
  document.getElementById('stat-failed').textContent =
    allParents.filter(p => ['FAILED','FAILURE'].includes((p.status || '').toUpperCase())).length;
  document.getElementById('stat-unstable').textContent =
    allParents.filter(p => (p.status || '').toUpperCase() === 'UNSTABLE').length;
}

function renderTable() {
  const tbody = document.getElementById('parent-tbody');
  tbody.innerHTML = '';
  const start = (page - 1) * CONFIG.PAGE_SIZE;
  const rows = filtered.slice(start, start + CONFIG.PAGE_SIZE);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:#94a3b8">No builds found</td></tr>`;
  } else {
    rows.forEach(p => {
      const tr = document.createElement('tr');
      if (selected && selected.build === p.build) tr.classList.add('selected');
      tr.onclick = () => showDetails(p.build);
      const cls = badgeClass(p.status);
      tr.innerHTML = `
        <td class="build-id">${p.build}</td>
        <td>${p.timestamp || '—'}</td>
        <td>${p.endTime || '—'}</td>
        <td><span class="badge ${cls}">${p.status || '—'}</span></td>
        <td>${p.duration || '—'}</td>
        <td style="text-align:center">${p.children ?? '—'}</td>
        <td style="text-align:center;color:var(--green);font-weight:600">${p.successCount ?? 0}</td>
        <td style="text-align:center;color:var(--red);font-weight:600">${p.failedCount ?? 0}</td>
        <td style="text-align:center;color:var(--amber);font-weight:600">${p.unstableCount ?? 0}</td>
        <td><button class="link">View details →</button></td>
      `;
      tbody.appendChild(tr);
    });
  }
  renderPager('parent-pagination', filtered.length, page, p => { page = p; renderTable(); });
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

function onSearch() {
  const q = document.getElementById('build-search').value.trim().toLowerCase();
  filtered = q
    ? allParents.filter(p => String(p.build).includes(q) || (p.job || '').toLowerCase().includes(q))
    : [...allParents];
  page = 1;
  renderTable();
}

async function showDetails(num) {
  const p = allParents.find(x => Number(x.build) === Number(num));
  if (!p || !currentOrch) return;
  selected = p;
  document.getElementById('detail-section').style.display = 'block';
  document.getElementById('detail-build-id').textContent = '#' + p.build;
  const badge = document.getElementById('detail-status-badge');
  badge.textContent = p.status || '—';
  badge.className = 'badge ' + badgeClass(p.status);
  document.getElementById('detail-time-range').textContent =
    `${p.timestamp || '—'} → ${p.endTime || '—'} (${p.duration || '—'})`;
  renderTable();

  try {
    const file = p.file || `Build_${p.build}.json`;
    const url = `data/${currentOrch.folder}/Builds/${file}?t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Cannot load ' + file);
    const data = await res.json();
    children = data.children || [];
    childPage = 1;
    renderChildren();
  } catch (e) {
    document.getElementById('children-tbody').innerHTML =
      `<tr><td colspan="8" style="text-align:center;padding:30px;color:#dc2626">${e.message}</td></tr>`;
  }
}

function renderChildren() {
  const tbody = document.getElementById('children-tbody');
  tbody.innerHTML = '';
  const start = (childPage - 1) * CONFIG.PAGE_SIZE;
  const rows = children.slice(start, start + CONFIG.PAGE_SIZE);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#94a3b8">No child builds</td></tr>`;
  } else {
    rows.forEach(c => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'default';
      const hasBuild = c.build != null && c.build !== '';
      let logCell = '—', action = '—';
      if (c.logFile) {
        logCell = `<span style="font-size:12px;color:#64748b">${c.logFile}</span>`;
        action = `<button class="link" onclick="alert('Log: ${c.logFile}')">View</button>`;
      } else if (c.reason) {
        logCell = `<span style="font-size:12px;color:#dc2626">${c.reason}</span>`;
        action = `<span style="font-size:12px;color:#94a3b8">No log</span>`;
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
  renderPager('children-pagination', children.length, childPage, p => {
    childPage = p;
    renderChildren();
  });
}
