const CONFIG = {
  ORCHESTRATORS_URL: 'orchestrators.json',
  SCHEDULED_URL: 'scheduled-jobs.json',
  SCHEDULE_SAVE_URL: 'http://10.59.234.217:8091/api/scheduled-jobs',
  PAGE_SIZE: 6,
  FAILED_PAGE_SIZE: 15,
  HISTORY_PAGE_SIZE: 15,
  SCHEDULED_PAGE_SIZE: 7
};

const DEFAULT_SCHEDULE_TZ = 'Europe/Berlin';

let orchestrators = [];
let allBuilds = [];
let filteredBuilds = [];
let currentPage = 1;
let selectedBuild = null;
let children = [];
let childrenPage = 1;
let activeOrchFilter = 'all';
let currentView = 'dashboard';

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
let editingScheduleId = null;

/** Cached scheduled failures for bell + FAILED card */
let cachedScheduledFailures = [];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh').onclick = refreshCurrentView;
  document.getElementById('qa-refresh').onclick = refreshCurrentView;
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

  const addBtn = document.getElementById('btn-add-scheduled');
  if (addBtn) addBtn.onclick = () => openScheduleModal(null);
  const modalClose = document.getElementById('schedule-modal-close');
  if (modalClose) modalClose.onclick = closeScheduleModal;
  const modalBackdrop = document.getElementById('schedule-modal-backdrop');
  if (modalBackdrop) modalBackdrop.onclick = closeScheduleModal;
  const sfCancel = document.getElementById('sf-cancel');
  if (sfCancel) sfCancel.onclick = closeScheduleModal;
  const sfSave = document.getElementById('sf-save');
  if (sfSave) sfSave.onclick = saveScheduleFromModal;

  initScheduleModalUi();
  loadAll();
});

async function refreshCurrentView() {
  if (currentView === 'scheduled') {
    await openScheduledView(true);
    await refreshBellAndFailedStats();
    return;
  }
  await loadAll();
  if (currentView === 'failed') await openFailedJobsView();
  else if (currentView === 'history') {
    historyCache = null;
    await openHistoryView();
  }
}

function setActiveNav(view) {
  currentView = view;
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

    // Load scheduled failures BEFORE stats so FAILED card + bell are correct
    await refreshBellAndFailedStats();

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
  const d = new Date(String(ts).replace(' ', 'T'));
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

/* ========== TIMEZONE + CALENDAR ========== */
function getZonedParts(date, timeZone) {
  const parts = {};
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short'
  });
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
    dow: dowMap[parts.weekday] ?? 0
  };
}

function wallTimeToUtcDate(y, month, d, h, min, sec, timeZone) {
  let guess = Date.UTC(y, month - 1, d, h, min, sec);
  for (let i = 0; i < 4; i++) {
    const p = getZonedParts(new Date(guess), timeZone);
    const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const target = Date.UTC(y, month - 1, d, h, min, sec);
    guess += target - asIfUtc;
  }
  return new Date(guess);
}

function formatNextRunBerlin(y, month, d, h, min) {
  return `${String(month).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

function addDaysToYmd(y, month, d, days) {
  const dt = new Date(Date.UTC(y, month - 1, d + days));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function lastDayOfMonth(y, month) {
  return new Date(Date.UTC(y, month, 0)).getUTCDate();
}

function ymdKey(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function afterOrOnFromDate(parts, fromDate) {
  if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return true;
  return ymdKey(parts.year, parts.month, parts.day) >= fromDate;
}

function jobMatchesDay(job, parts) {
  if (!afterOrOnFromDate(parts, job.fromDate)) return false;

  const cal = (job.calendar || 'DAILY').toString().toUpperCase();
  if (cal === 'CUSTOM' && job.custom) {
    const custom = job.custom;
    const kind = custom.kind || '';
    if (kind === 'monthly_days') {
      return (custom.daysOfMonth || []).map(Number).includes(parts.day);
    }
    if (kind === 'monthly_last') return parts.day === lastDayOfMonth(parts.year, parts.month);
    if (kind === 'every_x_days') {
      const x = Number(custom.everyXDays || 0);
      const from = (custom.fromDate || job.fromDate || '').toString();
      if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return false;
      const [fy, fm, fd] = from.split('-').map(Number);
      const fromUtc = Date.UTC(fy, fm - 1, fd);
      const curUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
      if (curUtc < fromUtc) return false;
      return Math.round((curUtc - fromUtc) / 86400000) % x === 0;
    }
    if (kind === 'weekly_days') return (custom.weekDays || []).map(Number).includes(parts.dow);
    if (kind === 'specific_dates') {
      return (custom.specificDates || []).includes(ymdKey(parts.year, parts.month, parts.day));
    }
  }

  const dow = parts.dow;
  const dom = parts.day;
  switch (cal) {
    case 'DAILY': return true;
    case 'WEEKDAYS': return dow >= 1 && dow <= 5;
    case 'WEEKENDS': return dow === 0 || dow === 6;
    case 'WEEKLY_SUN': return dow === 0;
    case 'WEEKLY_MON': return dow === 1;
    case 'WEEKLY_TUE': return dow === 2;
    case 'WEEKLY_WED': return dow === 3;
    case 'WEEKLY_THU': return dow === 4;
    case 'WEEKLY_FRI': return dow === 5;
    case 'WEEKLY_SAT': return dow === 6;
    case 'MONTHLY_1': return dom === 1;
    case 'MONTHLY_15': return dom === 15;
    case 'MONTHLY_LAST': return dom === lastDayOfMonth(parts.year, parts.month);
    default: {
      const m = cal.match(/^MONTHLY_(\d{1,2})$/);
      if (m) return dom === parseInt(m[1], 10);
      return true;
    }
  }
}

function computeNextRuns(job, count) {
  const timeZone = (job.timezone || DEFAULT_SCHEDULE_TZ).toString();
  const start = (job.startTime || '').toString().trim();
  const m = start.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return [];
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const now = new Date();
  const nowZ = getZonedParts(now, timeZone);
  const out = [];

  for (let i = 0; i < 900 && out.length < count; i++) {
    const ymd = addDaysToYmd(nowZ.year, nowZ.month, nowZ.day, i);
    const noon = wallTimeToUtcDate(ymd.year, ymd.month, ymd.day, 12, 0, 0, timeZone);
    const dayParts = getZonedParts(noon, timeZone);
    dayParts.year = ymd.year;
    dayParts.month = ymd.month;
    dayParts.day = ymd.day;
    if (!jobMatchesDay(job, dayParts)) continue;
    const runAt = wallTimeToUtcDate(ymd.year, ymd.month, ymd.day, hour, minute, 0, timeZone);
    if (runAt.getTime() > now.getTime()) {
      out.push(formatNextRunBerlin(ymd.year, ymd.month, ymd.day, hour, minute));
    }
  }
  return out;
}

function computeNextRun(job) {
  const list = computeNextRuns(job, 1);
  return list[0] || '—';
}

function normalizeScheduledJob(j) {
  const name = j.name || j.job || '—';
  const calendar = (j.calendar || 'DAILY').toString().toUpperCase();
  const startTime = j.startTime || '—';
  const fromDate = j.fromDate || (j.custom && j.custom.fromDate) || null;
  const base = {
    ...j,
    name,
    job: name,
    calendar,
    startTime,
    fromDate,
    transferType: j.transferType || 'ROBOCOPY',
    type: 'TRANSFER',
    enabled: j.enabled !== false,
    timezone: j.timezone || DEFAULT_SCHEDULE_TZ
  };
  base.nextRunDisplay = computeNextRun(base);
  return base;
}

function scheduleTypeBadge(t) {
  const v = (t || '').toUpperCase();
  if (v === 'CUSTOM') return 'badge-monthly';
  if (v === 'DAILY' || v === 'WEEKDAYS') return 'badge-daily';
  if (v.startsWith('WEEKLY') || v === 'WEEKENDS') return 'badge-weekly';
  if (v.startsWith('MONTHLY')) return 'badge-monthly';
  return 'badge-other';
}

/* ========== SCHEDULED FAILURES (bell + FAILED card) ========== */
async function loadScheduledJobsRaw() {
  try {
    const res = await fetch(CONFIG.SCHEDULED_URL + '?t=' + Date.now());
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function collectScheduledFailures() {
  const list = await loadScheduledJobsRaw();
  const failures = [];
  await Promise.all(list.map(async job => {
    const name = job.name || job.job;
    if (!name) return;
    const folder = job.folder || name;
    try {
      const r = await fetch(`data/scheduled/${encodeURIComponent(folder)}/history.json?t=${Date.now()}`);
      if (!r.ok) return;
      const hist = await r.json();
      if (!Array.isArray(hist)) return;
      hist.forEach(h => {
        const st = (h.status || '').toUpperCase();
        if (st !== 'FAILED' && st !== 'FAILURE') return;
        const failTime = h.endTime || h.startTime || '—';
        failures.push({
          job: name,
          parentBuild: h.build != null ? h.build : '—',
          orchestrator: 'Scheduled',
          orchestratorColor: '#8b5cf6',
          status: h.status,
          reason: h.reason || 'Scheduled job failed',
          startTime: failTime,
          logFile: h.logFile || null,
          source: 'scheduled',
          _sortKey: parseTimestamp(failTime) || 0
        });
      });
    } catch (e) {
      console.warn(e);
    }
  }));
  return failures;
}

async function refreshBellAndFailedStats() {
  cachedScheduledFailures = await collectScheduledFailures();
  updateStats();
  updateBellFromCaches();
}

function updateBellFromCaches() {
  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;

  let count = allBuilds.filter(b => {
    const t = parseTimestamp(b.timestamp);
    return t && now - t <= h24;
  }).reduce((s, b) => s + (b.failedCount || 0), 0);

  count += cachedScheduledFailures.filter(f => f._sortKey && now - f._sortKey <= h24).length;

  if (count > 0) updateBellBadge(count);
  else {
    updateBellBadge(0);
    if (count === 0) bellCleared = false;
  }
}

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
          const key = `orch||${parent.build}||${c.job || ''}`;
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
            source: 'orchestrator',
            _sortKey: parseTimestamp(failTime) || 0
          });
        });
      } catch (e) {
        console.warn(e);
      }
    }

    // Always re-load scheduled failures for this view
    cachedScheduledFailures = await collectScheduledFailures();
    cachedScheduledFailures.forEach(f => {
      const key = `sched||${f.job}||${f.parentBuild}`;
      if (seen.has(key)) return;
      seen.add(key);
      failedJobs.push(f);
    });
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
    `${failedJobs.length} failed job${failedJobs.length !== 1 ? 's' : ''} (orchestrator + scheduled)`;
  setActiveNav('failed');
  renderFailedJobs();
  updateBellFromCaches();
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
      const parentLabel = f.source === 'scheduled' ? `Sched #${f.parentBuild}` : `#${f.parentBuild}`;
      tr.innerHTML = `
        <td style="font-weight:500">${f.job}</td>
        <td class="build-id">${parentLabel}</td>
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

/* ========== JOB HISTORY ========== */
async function openHistoryView() {
  if (isLoadingHistory) return;
  isLoadingHistory = true;
  try {
    if (historyCache) {
      historyJobs = historyCache;
      filteredHistoryJobs = [...historyJobs];
      historyPage = 1;
      selectedHistoryJob = null;
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
    selectedHistoryJob = null;
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
  const panel = document.getElementById('history-detail-panel');
  if (panel) panel.style.display = 'none';
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
        (h.transferType || '').toLowerCase().includes(q)
      );
  historyPage = 1;
  selectedHistoryJob = null;
  document.getElementById('history-subtitle').textContent =
    `${filteredHistoryJobs.length} unique job${filteredHistoryJobs.length !== 1 ? 's' : ''} found`;
  const panel = document.getElementById('history-detail-panel');
  if (panel) panel.style.display = 'none';
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
      tr.style.cursor = 'pointer';
      if (selectedHistoryJob && selectedHistoryJob.job === h.job) tr.classList.add('selected');
      tr.onclick = () => showHistoryJobDetails(h);
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
    selectedHistoryJob = null;
    const panel = document.getElementById('history-detail-panel');
    if (panel) panel.style.display = 'none';
    renderHistoryJobs();
  });
}

function showHistoryJobDetails(h) {
  selectedHistoryJob = h;
  renderHistoryJobs();
  const panel = document.getElementById('history-detail-panel');
  if (!panel) return;
  panel.style.display = 'block';
  document.getElementById('history-detail-title').textContent = h.job || '—';
  document.getElementById('hd-source').textContent = displayPath(h.source);
  document.getElementById('hd-destination').textContent = displayPath(h.destination);
  document.getElementById('hd-type').textContent = h.transferType || '—';
  document.getElementById('hd-mask').textContent = h.fileMask || '—';
  document.getElementById('hd-flags').textContent = h.flags || '—';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ========== SCHEDULED ========== */
async function openScheduledView(forceReload) {
  if (isLoadingScheduled && !forceReload) return;
  isLoadingScheduled = true;
  try {
    const res = await fetch(CONFIG.SCHEDULED_URL + '?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      scheduledJobs = (Array.isArray(data) ? data : []).map(normalizeScheduledJob);
    } else {
      scheduledJobs = [];
    }

    await Promise.all(scheduledJobs.map(async job => {
      try {
        const folder = (job.folder || job.name || job.job || '').toString();
        if (!folder) {
          job._history = [];
          job.lastRun = '—';
          job.lastStatus = '—';
          return;
        }
        const r = await fetch(`data/scheduled/${encodeURIComponent(folder)}/history.json?t=${Date.now()}`);
        if (!r.ok) {
          job._history = [];
          job.lastRun = '—';
          job.lastStatus = '—';
          return;
        }
        const hist = await r.json();
        job._history = Array.isArray(hist) ? hist : [];
        if (job._history.length) {
          const last = job._history[0];
          job.lastRun = last.startTime || last.endTime || '—';
          job.lastStatus = last.status || '—';
        } else {
          job.lastRun = '—';
          job.lastStatus = '—';
        }
      } catch {
        job._history = [];
        job.lastRun = '—';
        job.lastStatus = '—';
      }
    }));
  } catch (e) {
    console.warn(e);
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
  const histBody = document.getElementById('sched-history-tbody');
  if (histBody) histBody.innerHTML = '';

  document.getElementById('scheduled-search').value = '';
  document.getElementById('scheduled-filter-type').value = 'all';
  document.getElementById('scheduled-subtitle').textContent = scheduledJobs.length
    ? `${scheduledJobs.length} scheduled job${scheduledJobs.length !== 1 ? 's' : ''}`
    : 'No scheduled-jobs.json found yet';

  setActiveNav('scheduled');
  renderScheduledTable();
  renderScheduleSummary();
  renderNextRuns();
  document.getElementById('footer-info').textContent = `Showing ${scheduledJobs.length} scheduled jobs`;

  const now = new Date().toLocaleString('en-GB');
  document.getElementById('last-updated').textContent = now;

  // Refresh bell/FAILED after scheduled data changed
  await refreshBellAndFailedStats();
}

function filterScheduled() {
  const q = (document.getElementById('scheduled-search').value || '').toLowerCase().trim();
  const type = document.getElementById('scheduled-filter-type').value;
  filteredScheduled = scheduledJobs.filter(j => {
    const cal = (j.calendar || '').toUpperCase();
    if (type !== 'all' && cal !== type.toUpperCase()) return false;
    if (q && !(j.name || j.job || '').toLowerCase().includes(q)) return false;
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
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8">No scheduled jobs found</td></tr>`;
  } else {
    page.forEach(j => {
      const tr = document.createElement('tr');
      if (selectedScheduled && (selectedScheduled.job === j.job || selectedScheduled.name === j.name)) {
        tr.classList.add('selected');
      }
      tr.onclick = () => showScheduledDetails(j);
      const activeBadge = j.enabled
        ? `<span class="badge badge-active">Active</span>`
        : `<span class="badge badge-inactive">Inactive</span>`;
      tr.innerHTML = `
        <td style="font-weight:500">${j.name || j.job || '—'}</td>
        <td>${activeBadge}</td>
        <td>${j.startTime || '—'}</td>
        <td><span class="badge ${scheduleTypeBadge(j.calendar)}">${j.calendar || '—'}</span></td>
        <td>${j.transferType || '—'}</td>
        <td>${j.nextRunDisplay || '—'}</td>
        <td>${j.lastRun || '—'}</td>
        <td><span class="badge ${badgeClass(j.lastStatus)}">${j.lastStatus || '—'}</span></td>
        <td class="row-actions"></td>`;
      const actionsTd = tr.querySelector('.row-actions');
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.onclick = (e) => { e.stopPropagation(); openScheduleModal(j); };
      actionsTd.appendChild(editBtn);
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

  const card = document.getElementById('scheduled-detail-card');
  card.style.display = 'block';

  document.getElementById('sched-detail-name').textContent = j.name || j.job || '—';
  document.getElementById('sched-detail-schedule').textContent =
    `${j.calendar || '—'} at ${j.startTime || '—'}`;
  document.getElementById('sched-detail-tz').textContent =
    `Time zone: ${j.timezone || DEFAULT_SCHEDULE_TZ}`;
  const fromEl = document.getElementById('sched-detail-from');
  if (fromEl) {
    fromEl.textContent = j.fromDate ? `Valid from: ${j.fromDate}` : 'Valid from: immediately';
  }
  document.getElementById('sched-detail-next').textContent = j.nextRunDisplay || '—';
  document.getElementById('sched-detail-last').textContent = j.lastRun || '—';
  document.getElementById('sched-detail-last-status').innerHTML = j.lastStatus
    ? `<span class="badge ${badgeClass(j.lastStatus)}" style="margin-top:4px;display:inline-block">${j.lastStatus}</span>`
    : '';

  const activeEl = document.getElementById('sched-detail-active');
  if (activeEl) {
    activeEl.textContent = j.enabled ? 'Active' : 'Inactive';
    activeEl.className = 'badge ' + (j.enabled ? 'badge-success' : 'badge-other');
  }

  document.getElementById('sched-detail-source').textContent = displayPath(j.source);
  document.getElementById('sched-detail-destination').textContent = displayPath(j.destination);
  document.getElementById('sched-detail-mask').textContent = j.fileMask || '—';
  document.getElementById('sched-detail-flags').textContent = j.flags || '—';

  const tbody = document.getElementById('sched-history-tbody');
  tbody.innerHTML = '';

  const hist = Array.isArray(j._history) ? j._history.slice(0, 2) : [];

  if (!hist.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8">No execution history yet</td></tr>`;
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
  const counts = { DAILY: 0, WEEKLY: 0, MONTHLY: 0 };
  scheduledJobs.forEach(j => {
    const c = (j.calendar || '').toUpperCase();
    if (c === 'DAILY' || c === 'WEEKDAYS' || c === 'WEEKENDS') counts.DAILY++;
    else if (c.startsWith('WEEKLY')) counts.WEEKLY++;
    else counts.MONTHLY++;
  });
  const total = scheduledJobs.length || 1;
  document.getElementById('sched-donut-total').textContent = scheduledJobs.length;
  const segs = [
    { val: counts.DAILY, color: '#2563eb' },
    { val: counts.WEEKLY, color: '#8b5cf6' },
    { val: counts.MONTHLY, color: '#f59e0b' }
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
    <div class="legend-row"><span class="legend-dot" style="background:#2563eb"></span> Daily/Weekday ${counts.DAILY} (${pct(counts.DAILY)}%)</div>
    <div class="legend-row"><span class="legend-dot" style="background:#8b5cf6"></span> Weekly ${counts.WEEKLY} (${pct(counts.WEEKLY)}%)</div>
    <div class="legend-row"><span class="legend-dot" style="background:#f59e0b"></span> Monthly ${counts.MONTHLY} (${pct(counts.MONTHLY)}%)</div>`;
}

function renderNextRuns() {
  const ul = document.getElementById('next-runs-list');
  ul.innerHTML = '';

  // Only the next 7 upcoming runs
  const list = [...scheduledJobs]
    .filter(j => j.enabled !== false && j.nextRunDisplay && j.nextRunDisplay !== '—')
    .sort((a, b) => String(a.nextRunDisplay).localeCompare(String(b.nextRunDisplay)))
    .slice(0, 7);

  if (!list.length) {
    ul.innerHTML = `<li style="color:#94a3b8;font-size:12px;padding:12px 0">No upcoming runs</li>`;
    return;
  }

  list.forEach(j => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="next-run-left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        <div>
          <div class="next-run-name" title="${j.name || j.job}">${j.name || j.job}</div>
          <div class="next-run-when">${j.nextRunDisplay}</div>
        </div>
      </div>
      <span class="next-run-badge">${j.calendar || ''}</span>`;
    ul.appendChild(li);
  });
}

/* ========== SCHEDULE MODAL ========== */
function initScheduleModalUi() {
  ['sf-start', 'sf-tz', 'sf-calendar', 'sf-from-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateNextPreview);
      el.addEventListener('change', updateNextPreview);
    }
  });
}

function openScheduleModal(job) {
  editingScheduleId = job ? (job.id || job.name || job.job) : null;
  document.getElementById('schedule-modal-title').textContent =
    job ? 'Edit Scheduled Job' : 'Add Scheduled Job';
  document.getElementById('sf-error').hidden = true;

  const nameInput = document.getElementById('sf-name');
  nameInput.value = job ? (job.name || job.job || '') : '';
  nameInput.disabled = !!job;

  document.getElementById('sf-folder').value = job ? (job.folder || '') : '';
  document.getElementById('sf-enabled').value = job && job.enabled === false ? 'false' : 'true';
  document.getElementById('sf-start').value = job ? (job.startTime || '') : '02:30';

  const tzSel = document.getElementById('sf-tz');
  const tz = job ? (job.timezone || DEFAULT_SCHEDULE_TZ) : DEFAULT_SCHEDULE_TZ;
  if (tzSel && ![...tzSel.options].some(o => o.value === tz)) {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.textContent = tz;
    tzSel.appendChild(opt);
  }
  if (tzSel) tzSel.value = tz;

  document.getElementById('sf-transfer').value = job ? (job.transferType || 'ROBOCOPY') : 'ROBOCOPY';
  document.getElementById('sf-source').value = job ? (job.source || '') : '';
  document.getElementById('sf-destination').value = job ? (job.destination || '') : '';
  document.getElementById('sf-mask').value = job ? (job.fileMask || '*.*') : '*.*';
  document.getElementById('sf-flags').value = job ? (job.flags || '/R:0 /W:0 /NP') : '/R:0 /W:0 /NP';
  document.getElementById('sf-cred').value = job ? (job.credentialId || 'WIN.SVC.UC4.BATCHUSER') : 'WIN.SVC.UC4.BATCHUSER';

  let cal = job ? (job.calendar || 'DAILY') : 'DAILY';
  if (String(cal).toUpperCase() === 'CUSTOM') cal = 'DAILY';
  document.getElementById('sf-calendar').value = cal;
  document.getElementById('sf-from-date').value = job && job.fromDate ? job.fromDate : '';

  updateNextPreview();
  document.getElementById('schedule-modal').hidden = false;
}

function closeScheduleModal() {
  document.getElementById('schedule-modal').hidden = true;
  editingScheduleId = null;
  document.getElementById('sf-name').disabled = false;
}

function buildJobFromForm() {
  const name = document.getElementById('sf-name').value.trim();
  const start = document.getElementById('sf-start').value.trim();
  const source = document.getElementById('sf-source').value.trim();
  const dest = document.getElementById('sf-destination').value.trim();
  if (!name || !start || !source || !dest) {
    throw new Error('Job Name, Start Time, Source and Destination are required');
  }
  if (!/^\d{1,2}:\d{2}$/.test(start)) throw new Error('Start Time must be HH:mm (24h)');
  const folder = document.getElementById('sf-folder').value.trim() || name;
  const fromDate = document.getElementById('sf-from-date').value || null;

  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    folder,
    enabled: document.getElementById('sf-enabled').value === 'true',
    startTime: start,
    calendar: document.getElementById('sf-calendar').value,
    fromDate,
    custom: null,
    type: 'TRANSFER',
    transferType: document.getElementById('sf-transfer').value,
    source,
    destination: dest,
    fileMask: document.getElementById('sf-mask').value.trim() || '*.*',
    flags: document.getElementById('sf-flags').value.trim() || '/R:0 /W:0 /NP',
    credentialId: document.getElementById('sf-cred').value.trim() || 'WIN.SVC.UC4.BATCHUSER',
    timezone: document.getElementById('sf-tz').value || DEFAULT_SCHEDULE_TZ
  };
}

function updateNextPreview() {
  const el = document.getElementById('sf-next-preview');
  const listEl = document.getElementById('sf-run-preview');
  if (!el) return;
  try {
    const draft = {
      startTime: document.getElementById('sf-start').value.trim(),
      timezone: document.getElementById('sf-tz').value || DEFAULT_SCHEDULE_TZ,
      calendar: document.getElementById('sf-calendar').value,
      fromDate: document.getElementById('sf-from-date').value || null
    };
    const runs = computeNextRuns(draft, 10);
    el.textContent = runs.length
      ? `Next run: ${runs[0]} (${draft.timezone})`
      : `Next run: — (${draft.timezone})`;
    if (listEl) {
      if (!runs.length) {
        listEl.innerHTML = '<div class="hint">No upcoming executions with current settings.</div>';
      } else {
        listEl.innerHTML = runs.map((r, i) => `<div class="run-line">${i + 1}. ${r}</div>`).join('');
      }
    }
  } catch {
    el.textContent = 'Next run preview: —';
    if (listEl) listEl.innerHTML = '<div class="hint">Complete the schedule fields.</div>';
  }
}

function scheduledJobsForSave() {
  return scheduledJobs.map(j => ({
    id: j.id || (j.name || j.job || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: j.name || j.job,
    folder: j.folder || j.name || j.job,
    enabled: j.enabled !== false,
    startTime: j.startTime,
    calendar: j.calendar || 'DAILY',
    fromDate: j.fromDate || null,
    custom: null,
    type: 'TRANSFER',
    transferType: j.transferType || 'ROBOCOPY',
    source: j.source || '',
    destination: j.destination || '',
    fileMask: j.fileMask || '*.*',
    flags: j.flags || '/R:0 /W:0 /NP',
    credentialId: j.credentialId || 'WIN.SVC.UC4.BATCHUSER',
    timezone: j.timezone || DEFAULT_SCHEDULE_TZ
  }));
}

async function persistScheduledJobs(list) {
  const res = await fetch(CONFIG.SCHEDULE_SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list, null, 2)
  });
  if (!res.ok) throw new Error('Save failed: ' + (await res.text()));
}

async function saveScheduleFromModal() {
  const errEl = document.getElementById('sf-error');
  try {
    const entry = buildJobFromForm();
    let list = scheduledJobsForSave();
    if (editingScheduleId) {
      const idx = list.findIndex(j => j.id === editingScheduleId || j.name === editingScheduleId);
      if (idx >= 0) list[idx] = { ...list[idx], ...entry, name: list[idx].name, id: list[idx].id };
      else list.push(entry);
    } else {
      if (list.some(j => j.name === entry.name)) throw new Error('A job with this name already exists');
      list.push(entry);
    }
    await persistScheduledJobs(list);
    closeScheduleModal();
    await openScheduledView(true);
    alert('scheduled-jobs.json updated successfully');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.hidden = false;
  }
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

/* ========== ORCH / STATS / BUILDS ========== */
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

/**
 * Stats include orchestrator child counts + scheduled failures (FAILED card + rings).
 */
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

  const totalSuccessChildren = allBuilds.reduce((s, b) => s + (b.successCount || 0), 0);
  const orchFailed = allBuilds.reduce((s, b) => s + (b.failedCount || 0), 0);
  const schedFailed = cachedScheduledFailures.length;
  const totalFailedChildren = orchFailed + schedFailed;
  const totalUnstableChildren = allBuilds.reduce((s, b) => s + (b.unstableCount || 0), 0);
  const totalChildren = totalSuccessChildren + totalFailedChildren + totalUnstableChildren || 1;

  document.getElementById('stat-total').textContent = allBuilds.length;
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

  const schedFailedLast24 = cachedScheduledFailures.filter(f => f._sortKey && now - f._sortKey <= h24).length;
  const orchFailedLast24 = last24.reduce((s, b) => s + (b.failedCount || 0), 0);
  const prevOrchFailed = prev24.reduce((s, b) => s + (b.failedCount || 0), 0);

  setTrend('trend-total', last24.length - prev24.length);
  setTrend('trend-success', last24.reduce((s, b) => s + (b.successCount || 0), 0) - prev24.reduce((s, b) => s + (b.successCount || 0), 0));
  setTrend('trend-failed', (orchFailedLast24 + schedFailedLast24) - prevOrchFailed);
  setTrend('trend-unstable', last24.reduce((s, b) => s + (b.unstableCount || 0), 0) - prev24.reduce((s, b) => s + (b.unstableCount || 0), 0));
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
  const orchFailed = allBuilds.reduce((s, b) => s + (b.failedCount || 0), 0);
  const failed = orchFailed + cachedScheduledFailures.length;
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
  const WINDOW = 10;
  function addBtn(label, page, opts = {}) {
    const b = document.createElement('button');
    b.className = 'page-btn' + (opts.active ? ' active' : '');
    b.textContent = label;
    b.disabled = !!opts.disabled;
    if (!opts.disabled && page != null) b.onclick = () => cb(page);
    el.appendChild(b);
  }
  addBtn('‹', current - 1, { disabled: current <= 1 });
  let start = Math.max(1, current - Math.floor(WINDOW / 2));
  let end = start + WINDOW - 1;
  if (end > pages) { end = pages; start = Math.max(1, end - WINDOW + 1); }
  if (start > 1) {
    addBtn('1', 1);
    if (start > 2) {
      const dots = document.createElement('span');
      dots.textContent = '…';
      dots.style.cssText = 'padding:0 4px;color:#94a3b8;font-size:12px;align-self:center';
      el.appendChild(dots);
    }
  }
  for (let i = start; i <= end; i++) addBtn(String(i), i, { active: i === current });
  if (end < pages) {
    if (end < pages - 1) {
      const dots = document.createElement('span');
      dots.textContent = '…';
      dots.style.cssText = 'padding:0 4px;color:#94a3b8;font-size:12px;align-self:center';
      el.appendChild(dots);
    }
    addBtn(String(pages), pages);
  }
  addBtn('›', current + 1, { disabled: current >= pages });
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
