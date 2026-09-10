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
let selectedHistoryJob = null;

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
    selectedHistoryJob = null;
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
  const v = (t || '').toUpperCase();
  if (v === 'DAILY' || v === 'WEEKDAYS') return 'badge-daily';
  if (v.startsWith('WEEKLY')) return 'badge-weekly';
  if (v.startsWith('MONTHLY')) return 'badge-monthly';
  if (v === 'WEEKENDS') return 'badge-weekly';
  return 'badge-other';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatNextRun(d) {
  if (!d || isNaN(d.getTime())) return '—';
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}

/** Approximate next run from calendar +
