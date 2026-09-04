/* ============================================================
   Master Build Dashboard
   ============================================================ */

const CONFIG = {
  INDEX_URL: 'index.json',
  BUILDS_PATH: 'Builds/',
  PAGE_SIZE: 8
};

let allParents = [];
let filteredParents = [];
let currentPage = 1;
let selectedBuild = null;
let childrenPage = 1;
let currentChildren = [];

// ---------- INIT ----------
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh').addEventListener('click', loadDashboard);
  document.getElementById('build-search').addEventListener('input', onSearch);
  document.getElementById('search-clear').addEventListener('click', clearSearch);
  document.getElementById('btn-download-all').addEventListener('click', downloadAll);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);

  loadDashboard();
  // Manual refresh only – no auto-refresh
});

// ---------- LOAD ----------
async function loadDashboard() {
  try {
    const res = await fetch(CONFIG.INDEX_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error('Could not load index.json');

    allParents = await res.json();
    allParents.sort((a, b) => Number(b.build) - Number(a.build));

    filteredParents = [...allParents];
    currentPage = 1;

    updateStats();
    renderParentTable();
    updateFooter();

    const now = new Date().toLocaleString('en-GB');
    document.getElementById('last-updated').textContent = now;
    document.getElementById('footer-generated').textContent = 'Generated: ' + now;

    // Keep selection if possible
    if (selectedBuild) {
      const still = allParents.find(p => p.build === selectedBuild.build);
      if (still) {
        await showDetails(still.build);
      } else {
        hideDetails();
      }
    }
  } catch (err) {
    console.error(err);
    alert('Error loading dashboard:\n' + err.message);
  }
}

// ---------- STATS ----------
function updateStats() {
  const total = allParents.length;
  const success = allParents.filter(p => (p.status || '').toUpperCase() === 'SUCCESS').length;
  const failed = allParents.filter(p => {
    const s = (p.status || '').toUpperCase();
    return s === 'FAILED' || s === 'FAILURE';
  }).length;
  const unstable = allParents.filter(p => (p.status || '').toUpperCase() === 'UNSTABLE').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-success').textContent = success;
  document.getElementById('stat-failed').textContent = failed;
  document.getElementById('stat-unstable').textContent = unstable;
}

// ---------- PARENT TABLE ----------
function renderParentTable() {
  const tbody = document.getElementById('parent-tbody');
  tbody.innerHTML = '';

  const start = (currentPage - 1) * CONFIG.PAGE_SIZE;
  const page = filteredParents.slice(start, start + CONFIG.PAGE_SIZE);

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:32px;color:#94a3b8">No builds found</td></tr>`;
    renderPagination('parent-pagination', filteredParents.length, currentPage, (p) => {
      currentPage = p;
      renderParentTable();
    });
    return;
  }

  page.forEach(p => {
    const tr = document.createElement('tr');
    if (selectedBuild && selectedBuild.build === p.build) {
      tr.classList.add('selected');
    }
    tr.addEventListener('click', () => showDetails(p.build));

    const statusClass = statusBadgeClass(p.status);

    tr.innerHTML = `
      <td class="build-id">${p.build}</td>
      <td>${p.timestamp || '—'}</td>
      <td>${p.endTime || '—'}</td>
      <td><span class="badge ${statusClass}">${p.status || '—'}</span></td>
      <td>${p.duration || '—'}</td>
      <td class="center">${p.children ?? '—'}</td>
      <td class="center" style="color:var(--success);font-weight:600">${p.successCount ?? p.children ?? 0}</td>
      <td class="center" style="color:var(--failed);font-weight:600">${p.failedCount ?? 0}</td>
      <td class="center" style="color:var(--unstable);font-weight:600">${p.unstableCount ?? 0}</td>
      <td>
        <button class="link-btn" type="button">View details →</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPagination('parent-pagination', filteredParents.length, currentPage, (p) => {
    currentPage = p;
    renderParentTable();
  });
}

function statusBadgeClass(status) {
  if (!status) return 'badge-other';
  const s = status.toUpperCase();
  if (s === 'SUCCESS') return 'badge-success';
  if (s === 'FAILED' || s === 'FAILURE') return 'badge-failed';
  if (s === 'UNSTABLE') return 'badge-unstable';
  return 'badge-other';
}

// ---------- PAGINATION ----------
function renderPagination(containerId, totalItems, current, onChange) {
  const totalPages = Math.max(1, Math.ceil(totalItems / CONFIG.PAGE_SIZE));
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const prev = document.createElement('button');
  prev.className = 'page-btn';
  prev.innerHTML = '‹';
  prev.disabled = current === 1;
  prev.onclick = () => onChange(current - 1);
  container.appendChild(prev);

  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 9 && Math.abs(i - current) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) {
        const dots = document.createElement('span');
        dots.textContent = '…';
        dots.style.padding = '0 4px';
        container.appendChild(dots);
      }
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (i === current ? ' active' : '');
    btn.textContent = i;
    btn.onclick = () => onChange(i);
    container.appendChild(btn);
  }

  const next = document.createElement('button');
  next.className = 'page-btn';
  next.innerHTML = '›';
  next.disabled = current === totalPages;
  next.onclick = () => onChange(current + 1);
  container.appendChild(next);
}

// ---------- SEARCH ----------
function onSearch() {
  const q = document.getElementById('build-search').value.trim().toLowerCase();
  document.getElementById('search-clear').hidden = !q;

  if (!q) {
    filteredParents = [...allParents];
  } else {
    filteredParents = allParents.filter(p =>
      String(p.build).includes(q) ||
      (p.job || '').toLowerCase().includes(q)
    );
  }
  currentPage = 1;
  renderParentTable();
  updateFooter();
}

function clearSearch() {
  document.getElementById('build-search').value = '';
  document.getElementById('search-clear').hidden = true;
  filteredParents = [...allParents];
  currentPage = 1;
  renderParentTable();
  updateFooter();
}

// ---------- DETAILS ----------
async function showDetails(buildNumber) {
  const parent = allParents.find(p => Number(p.build) === Number(buildNumber));
  if (!parent) return;

  selectedBuild = parent;

  document.getElementById('detail-section').hidden = false;
  document.getElementById('detail-build-id').textContent = '#' + parent.build;

  const badge = document.getElementById('detail-status-badge');
  badge.textContent = parent.status || '—';
  badge.className = 'badge ' + statusBadgeClass(parent.status);

  document.getElementById('detail-time-range').textContent =
    `${parent.timestamp || '—'}  →  ${parent.endTime || '—'}  (${parent.duration || '—'})`;

  renderParentTable(); // refresh selection highlight

  try {
    const file = parent.file || `Build_${parent.build}.json`;
    const res = await fetch(CONFIG.BUILDS_PATH + file + '?t=' + Date.now());
    if (!res.ok) throw new Error('Could not load ' + file);

    const data = await res.json();
    currentChildren = data.children || [];
    childrenPage = 1;
    renderChildren();
  } catch (err) {
    console.error(err);
    document.getElementById('children-tbody').innerHTML =
      `<tr><td colspan="8" style="text-align:center;padding:28px;color:#dc2626">Error: ${err.message}</td></tr>`;
  }
}

function hideDetails() {
  selectedBuild = null;
  document.getElementById('detail-section').hidden = true;
  renderParentTable();
}

function renderChildren() {
  const tbody = document.getElementById('children-tbody');
  tbody.innerHTML = '';

  const start = (childrenPage - 1) * CONFIG.PAGE_SIZE;
  const page = currentChildren.slice(start, start + CONFIG.PAGE_SIZE);

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:28px;color:#94a3b8">No child builds</td></tr>`;
  } else {
    page.forEach(c => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'default';

      const statusClass = statusBadgeClass(c.status);
      const hasRealBuild = c.build !== null && c.build !== undefined && c.build !== '';
      const hasLog = c.logFile;

     
      let logCell = '—';
      let actionCell = '—';

      if (hasLog) {
        logCell = `<span style="font-size:0.8rem;color:#64748b">${c.logFile}</span>`;
        actionCell = `<button class="link-btn" type="button" onclick="viewLog('${(c.logFile || '').replace(/'/g, "\\'")}')">View</button>`;
      } else if (c.reason) {
      
        logCell = `<span style="font-size:0.8rem;color:#dc2626" title="${c.reason}">${c.reason}</span>`;
        actionCell = `<span style="font-size:0.8rem;color:#94a3b8">No log</span>`;
      }

      tr.innerHTML = `
        <td style="font-weight:500">${c.job || '—'}</td>
        <td class="build-id">${hasRealBuild ? c.build : '—'}</td>
        <td>${c.startTime || '—'}</td>
        <td>${c.endTime || '—'}</td>
        <td><span class="badge ${statusClass}">${c.status || '—'}</span></td>
        <td>${c.duration || '—'}</td>
        <td>${logCell}</td>
        <td>${actionCell}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderPagination('children-pagination', currentChildren.length, childrenPage, (p) => {
    childrenPage = p;
    renderChildren();
  });
}
// ---------- ACTIONS ----------
function viewLog(logFile) {
  if (!logFile) {
    alert('No log file available');
    return;
  }
  document.getElementById('modal-title').textContent = logFile;
  document.getElementById('modal-body').textContent =
    `Log file: ${logFile}\n\nFull path: C:\\Jenkins\\Jobs\\Log\\${logFile}\n\n(Implement real log loading here if desired)`;
  document.getElementById('log-modal').hidden = false;
}

function closeModal() {
  document.getElementById('log-modal').hidden = true;
}

function downloadAll() {
  if (!selectedBuild) return;
  alert('Download All – Build #' + selectedBuild.build +
        '\n\n(Implement bulk download according to your server)');
}

function updateFooter() {
  document.getElementById('footer-count').textContent =
    `Showing ${filteredParents.length} of ${allParents.length} builds`;
}
