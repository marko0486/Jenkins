/* ============================================================
   Master Build Dashboard – Logic
   ============================================================ */

(function () {
  "use strict";

  const INDEX_URL = "index.json";
  const BUILDS_DIR = "Builds/";
  const LOGS_BASE = "C:\\Jenkins\\Jobs\\Log\\";
  const PAGE_SIZE = 5;
  const REFRESH_MS = 30000;

  let indexData = [];
  let filteredData = [];
  let parentPage = 1;
  let childrenPage = 1;
  let selectedBuild = null;
  let currentChildren = [];
  let searchQuery = "";
  let cache = {};

  const $ = (sel) => document.querySelector(sel);
  const parentTbody = $("#parent-tbody");
  const childrenTbody = $("#children-tbody");
  const detailSection = $("#detail-section");
  const parentPagination = $("#parent-pagination");
  const childrenPagination = $("#children-pagination");
  const btnRefresh = $("#btn-refresh");
  const searchInput = $("#build-search");
  const searchClear = $("#search-clear");
  const modal = $("#log-modal");
  const modalBody = $("#modal-body");
  const modalTitle = $("#modal-title");

  function statusClass(status) {
    const s = (status || "").toUpperCase();
    if (s === "SUCCESS") return "badge-success";
    if (s === "FAILED" || s === "FAILURE") return "badge-failed";
    if (s === "UNSTABLE") return "badge-unstable";
    return "badge-unknown";
  }

  function statusLabel(status) {
    const s = (status || "").toUpperCase();
    if (s === "FAILURE") return "FAILED";
    return s || "UNKNOWN";
  }

  function countClass(n, type) {
    if (!n) return "count-zero";
    if (type === "success") return "count-success";
    if (type === "failed") return "count-failed";
    if (type === "unstable") return "count-unstable";
    return "";
  }

  function formatNow() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  async function loadBuildDetail(fileName) {
    if (cache[fileName]) return cache[fileName];
    const data = await fetchJson(BUILDS_DIR + fileName);
    cache[fileName] = data;
    return data;
  }

  function childCounts(detail) {
    const children = detail?.children || [];
    let success = 0, failed = 0, unstable = 0;
    children.forEach((c) => {
      const s = (c.status || "").toUpperCase();
      if (s === "SUCCESS") success++;
      else if (s === "FAILED" || s === "FAILURE") failed++;
      else if (s === "UNSTABLE") unstable++;
    });
    return { success, failed, unstable, total: children.length };
  }

  function totalPages(count) {
    return Math.max(1, Math.ceil(count / PAGE_SIZE));
  }

  function makePageBtn(page, current, onPage) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-btn" + (page === current ? " is-active" : "");
    btn.textContent = String(page);
    btn.addEventListener("click", () => onPage(page));
    return btn;
  }

  function renderPagination(container, current, total, onPage) {
    container.innerHTML = "";
    if (total <= 1) return;

    const frag = document.createDocumentFragment();

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "page-btn";
    prev.textContent = "‹";
    prev.disabled = current <= 1;
    prev.title = "Previous";
    prev.addEventListener("click", () => onPage(current - 1));
    frag.appendChild(prev);

    const maxButtons = 7;
    let start = Math.max(1, current - Math.floor(maxButtons / 2));
    let end = Math.min(total, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    if (start > 1) {
      frag.appendChild(makePageBtn(1, current, onPage));
      if (start > 2) {
        const dots = document.createElement("span");
        dots.className = "page-info";
        dots.textContent = "…";
        frag.appendChild(dots);
      }
    }

    for (let i = start; i <= end; i++) {
      frag.appendChild(makePageBtn(i, current, onPage));
    }

    if (end < total) {
      if (end < total - 1) {
        const dots = document.createElement("span");
        dots.className = "page-info";
        dots.textContent = "…";
        frag.appendChild(dots);
      }
      frag.appendChild(makePageBtn(total, current, onPage));
    }

    const next = document.createElement("button");
    next.type = "button";
    next.className = "page-btn";
    next.textContent = "›";
    next.disabled = current >= total;
    next.title = "Next";
    next.addEventListener("click", () => onPage(current + 1));
    frag.appendChild(next);

    const info = document.createElement("span");
    info.className = "page-info";
    info.textContent = `Page ${current} of ${total}`;
    frag.appendChild(info);

    container.appendChild(frag);
  }

  function updateStats() {
    let success = 0, failed = 0, unstable = 0;
    indexData.forEach((b) => {
      const s = (b.status || "").toUpperCase();
      if (s === "SUCCESS") success++;
      else if (s === "FAILED" || s === "FAILURE") failed++;
      else if (s === "UNSTABLE") unstable++;
    });
    $("#stat-total").textContent = indexData.length;
    $("#stat-success").textContent = success;
    $("#stat-failed").textContent = failed;
    $("#stat-unstable").textContent = unstable;
  }

  function applyFilter() {
    const q = searchQuery.trim();
    if (!q) {
      filteredData = indexData.slice();
    } else {
      filteredData = indexData.filter((b) => String(b.build).includes(q));
    }
    parentPage = 1;
  }

  async function renderParentTable() {
    const total = filteredData.length;
    const pages = totalPages(total);
    if (parentPage > pages) parentPage = pages;

    const startIdx = (parentPage - 1) * PAGE_SIZE;
    const slice = filteredData.slice(startIdx, startIdx + PAGE_SIZE);

    parentTbody.innerHTML = "";

    if (!slice.length) {
      const msg = searchQuery
        ? `No builds found matching “${escapeHtml(searchQuery)}”`
        : "No builds in index.json";
      parentTbody.innerHTML = `<tr><td colspan="10" class="empty-state">${msg}</td></tr>`;
      parentPagination.innerHTML = "";
      updateFooter();
      return;
    }

    const details = await Promise.all(
      slice.map(async (row) => {
        try {
          const d = await loadBuildDetail(row.file);
          return { row, detail: d };
        } catch (e) {
          return { row, detail: null };
        }
      })
    );

    const frag = document.createDocumentFragment();

    details.forEach(({ row, detail }) => {
      const counts = childCounts(detail);
      const startTime = row.timestamp || detail?.timestamp || "—";
      const endTime = detail?.endTime || "—";
      const duration = detail?.duration || "—";
      const tr = document.createElement("tr");
      if (selectedBuild === row.build) tr.classList.add("is-selected");

      tr.innerHTML = `
        <td><a href="#" class="build-link" data-build="${row.build}" data-file="${escapeHtml(row.file)}">${row.build}</a></td>
        <td>${escapeHtml(startTime)}</td>
        <td>${escapeHtml(endTime)}</td>
        <td><span class="badge ${statusClass(row.status)}">${statusLabel(row.status)}</span></td>
        <td>${escapeHtml(duration)}</td>
        <td>${counts.total || row.children || 0}</td>
        <td class="${countClass(counts.success, "success")}">${counts.success}</td>
        <td class="${countClass(counts.failed, "failed")}">${counts.failed}</td>
        <td class="${countClass(counts.unstable, "unstable")}">${counts.unstable}</td>
        <td><a href="#" class="detail-link" data-build="${row.build}" data-file="${escapeHtml(row.file)}">View details →</a></td>
      `;
      frag.appendChild(tr);
    });

    parentTbody.appendChild(frag);

    parentTbody.querySelectorAll(".build-link, .detail-link").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        openDetail(Number(el.dataset.build), el.dataset.file);
      });
    });

    renderPagination(parentPagination, parentPage, pages, (p) => {
      parentPage = p;
      renderParentTable();
    });

    updateFooter();
  }

  function updateFooter() {
    const total = filteredData.length;
    const start = total === 0 ? 0 : (parentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(parentPage * PAGE_SIZE, total);
    const suffix = searchQuery ? ` (filtered from ${indexData.length})` : "";
    $("#footer-count").textContent = `Showing ${start}–${end} of ${total} builds${suffix}`;
    $("#footer-generated").textContent = `Generated: ${formatNow()}`;
    $("#last-updated").textContent = formatNow();
  }

  async function openDetail(buildNum, fileName) {
    selectedBuild = buildNum;
    childrenPage = 1;
    detailSection.hidden = false;

    $("#detail-build-id").textContent = `#${buildNum}`;
    childrenTbody.innerHTML = `<tr class="loading-row"><td colspan="8">Loading details…</td></tr>`;
    childrenPagination.innerHTML = "";

    parentTbody.querySelectorAll("tr").forEach((tr) => tr.classList.remove("is-selected"));
    const link = parentTbody.querySelector(`[data-build="${buildNum}"]`);
    if (link) link.closest("tr")?.classList.add("is-selected");

    try {
      const detail = await loadBuildDetail(fileName);
      currentChildren = detail.children || [];
      renderDetailHeader(detail);
      renderChildrenTable();
      detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      currentChildren = [];
      childrenTbody.innerHTML = `<tr><td colspan="8" class="empty-state">Error loading ${escapeHtml(fileName)}: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function renderDetailHeader(detail) {
    const status = detail.status || "UNKNOWN";
    const badge = $("#detail-status-badge");
    badge.textContent = statusLabel(status);
    badge.className = `badge ${statusClass(status)}`;

    const start = detail.timestamp || "—";
    const end = detail.endTime || "—";
    const duration = detail.duration ? `(${detail.duration})` : "";
    $("#detail-time-range").textContent = `${start}  →  ${end} ${duration}`.trim();
    $("#logs-path").textContent = LOGS_BASE;
  }

  function renderChildrenTable() {
    const total = currentChildren.length;
    const pages = totalPages(total);
    if (childrenPage > pages) childrenPage = pages;

    const startIdx = (childrenPage - 1) * PAGE_SIZE;
    const slice = currentChildren.slice(startIdx, startIdx + PAGE_SIZE);

    childrenTbody.innerHTML = "";

    if (!slice.length) {
      childrenTbody.innerHTML = `<tr><td colspan="8" class="empty-state">No child jobs</td></tr>`;
      childrenPagination.innerHTML = "";
      return;
    }

    const frag = document.createDocumentFragment();
    slice.forEach((c) => {
      const logFile = c.logFile || `${c.job}_BuildID_${c.build}.txt`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(c.job)}</strong></td>
        <td><a href="${escapeHtml(c.buildUrl || "#")}" target="_blank" rel="noopener">${c.build ?? "—"}</a></td>
        <td>${escapeHtml(c.startTime || "—")}</td>
        <td>${escapeHtml(c.endTime || "—")}</td>
        <td><span class="badge ${statusClass(c.status)}">${statusLabel(c.status)}</span></td>
        <td>${escapeHtml(c.duration || "—")}</td>
        <td><span class="log-file-link" title="${escapeHtml(LOGS_BASE + logFile)}">📄 ${escapeHtml(logFile)}</span></td>
        <td>
          <button type="button" class="btn-action btn-view-log"
            data-logfile="${escapeHtml(logFile)}"
            data-job="${escapeHtml(c.job)}">👁 View</button>
        </td>
      `;
      frag.appendChild(tr);
    });
    childrenTbody.appendChild(frag);

    childrenTbody.querySelectorAll(".btn-view-log").forEach((btn) => {
      btn.addEventListener("click", () => {
        showLogModal(btn.dataset.job, btn.dataset.logfile);
      });
    });

    renderPagination(childrenPagination, childrenPage, pages, (p) => {
      childrenPage = p;
      renderChildrenTable();
    });
  }

  function showLogModal(jobName, logFile) {
    modal.hidden = false;
    modalTitle.textContent = `Log – ${jobName}`;
    modalBody.textContent =
      `File: ${LOGS_BASE}${logFile}\n\n` +
      `Note: browsers cannot read local files for security reasons.\n` +
      `Open the file manually from:\n${LOGS_BASE}${logFile}\n\n` +
      `If you serve the dashboard over HTTP with access to the Log folder,\n` +
      `you can extend dashboard.js to fetch the log content here.`;
  }

  function closeModal() {
    modal.hidden = true;
  }

  async function loadDashboard() {
    try {
      indexData = await fetchJson(INDEX_URL);
      if (!Array.isArray(indexData)) indexData = [];

      indexData.sort((a, b) => Number(b.build) - Number(a.build));

      if (indexData.length && indexData[0].job) {
        $("#page-title").textContent = indexData[0].job;
      }

      updateStats();
      applyFilter();
      await renderParentTable();

      if (searchQuery.trim()) {
        if (filteredData.length === 1) {
          await openDetail(filteredData[0].build, filteredData[0].file);
        } else if (filteredData.length > 0 && selectedBuild != null) {
          const row = filteredData.find((b) => b.build === selectedBuild);
          if (row) {
            delete cache[row.file];
            await openDetail(row.build, row.file);
          }
        }
      } else if (indexData.length && selectedBuild == null) {
        await openDetail(indexData[0].build, indexData[0].file);
      } else if (selectedBuild != null) {
        const row = indexData.find((b) => b.build === selectedBuild);
        if (row) {
          delete cache[row.file];
          await openDetail(row.build, row.file);
        }
      }
    } catch (e) {
      console.error(e);
      parentTbody.innerHTML = `<tr><td colspan="10" class="empty-state">
        Could not load <code>index.json</code>.<br/>
        Serve the dashboard over HTTP from the Dashboard folder (not file://).<br/>
        Error: ${escapeHtml(e.message)}
      </td></tr>`;
    }
  }

  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    searchClear.hidden = !searchQuery;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      applyFilter();
      await renderParentTable();
      const exact = filteredData.find((b) => String(b.build) === searchQuery.trim());
      if (exact) await openDetail(exact.build, exact.file);
    }, 250);
  });

  searchInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(searchTimer);
      searchQuery = searchInput.value;
      applyFilter();
      await renderParentTable();
      if (filteredData.length === 1) {
        await openDetail(filteredData[0].build, filteredData[0].file);
      } else {
        const exact = filteredData.find((b) => String(b.build) === searchQuery.trim());
        if (exact) await openDetail(exact.build, exact.file);
      }
    }
  });

  searchClear.addEventListener("click", async () => {
    searchInput.value = "";
    searchQuery = "";
    searchClear.hidden = true;
    applyFilter();
    await renderParentTable();
  });

  btnRefresh.addEventListener("click", async () => {
    cache = {};
    btnRefresh.style.transform = "rotate(360deg)";
    btnRefresh.style.transition = "transform 0.5s";
    setTimeout(() => {
      btnRefresh.style.transform = "";
      btnRefresh.style.transition = "";
    }, 500);
    await loadDashboard();
  });

  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-backdrop").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  $("#btn-download-all")?.addEventListener("click", () => {
    alert("Child job logs are stored at:\n" + LOGS_BASE + "\n\nOpen that folder on the Jenkins server to download them.");
  });

  setInterval(() => {
    cache = {};
    loadDashboard();
  }, REFRESH_MS);

  loadDashboard();
})();
