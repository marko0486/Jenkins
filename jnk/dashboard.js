/* ============================================================
   Master Build Dashboard – Logic
   ============================================================ */

(function () {
  "use strict";

  // ---------- Config ----------
  const INDEX_URL = "index.json";
  const BUILDS_DIR = "Builds/";
  const LOGS_BASE = "C:\\Jenkins\\Jobs\\Log\\";
  const PAGE_SIZE = 5;
  const REFRESH_MS = 30000;

  // ---------- State ----------
  let indexData = [];
  let visibleCount = PAGE_SIZE;
  let selectedBuild = null;
  let cache = {}; // Build_xxx.json cache

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const parentTbody = $("#parent-tbody");
  const childrenTbody = $("#children-tbody");
  const detailSection = $("#detail-section");
  const btnShowMore = $("#btn-show-more");
  const btnRefresh = $("#btn-refresh");
  const modal = $("#log-modal");
  const modalBody = $("#modal-body");
  const modalTitle = $("#modal-title");

  // ---------- Helpers ----------
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

  // ---------- Stats ----------
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

  // ---------- Parent table ----------
  async function renderParentTable() {
    const slice = indexData.slice(0, visibleCount);
    parentTbody.innerHTML = "";

    if (!slice.length) {
      parentTbody.innerHTML = `<tr><td colspan="10" class="empty-state">No hay builds en index.json</td></tr>`;
      btnShowMore.style.display = "none";
      updateFooter();
      return;
    }

    // Load details in parallel for visible rows
    const details = await Promise.all(
      slice.map(async (row) => {
        try {
          const d = await loadBuildDetail(row.file);
          return { row, detail: d, error: null };
        } catch (e) {
          return { row, detail: null, error: e.message };
        }
      })
    );

    const frag = document.createDocumentFragment();

    details.forEach(({ row, detail }) => {
      const counts = childCounts(detail);
      const start = row.timestamp || detail?.timestamp || "—";
      // Approximate end time is not in index; show dash or same if unknown
      const end = detail?.endTime || "—";
      const duration = detail?.duration || "—";
      const tr = document.createElement("tr");
      if (selectedBuild === row.build) tr.classList.add("is-selected");

      tr.innerHTML = `
        <td><a href="#" class="build-link" data-build="${row.build}" data-file="${escapeHtml(row.file)}">${row.build}</a></td>
        <td>${escapeHtml(start)}</td>
        <td>${escapeHtml(end)}</td>
        <td><span class="badge ${statusClass(row.status)}">${statusLabel(row.status)}</span></td>
        <td>${escapeHtml(duration)}</td>
        <td>${counts.total || row.children || 0}</td>
        <td class="${countClass(counts.success, "success")}">${counts.success}</td>
        <td class="${countClass(counts.failed, "failed")}">${counts.failed}</td>
        <td class="${countClass(counts.unstable, "unstable")}">${counts.unstable}</td>
        <td><a href="#" class="detail-link" data-build="${row.build}" data-file="${escapeHtml(row.file)}">Ver detalles →</a></td>
      `;
      frag.appendChild(tr);
    });

    parentTbody.appendChild(frag);

    // Bind links
    parentTbody.querySelectorAll(".build-link, .detail-link").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        const build = Number(el.dataset.build);
        const file = el.dataset.file;
        openDetail(build, file);
      });
    });

    btnShowMore.style.display = visibleCount >= indexData.length ? "none" : "inline-block";
    updateFooter();
  }

  function updateFooter() {
    const shown = Math.min(visibleCount, indexData.length);
    $("#footer-count").textContent = `Total de builds mostradas: ${shown} de ${indexData.length}`;
    $("#footer-generated").textContent = `Generado: ${formatNow()}`;
    $("#last-updated").textContent = formatNow();
  }

  // ---------- Detail panel ----------
  async function openDetail(buildNum, fileName) {
    selectedBuild = buildNum;
    detailSection.hidden = false;

    $("#detail-build-id").textContent = `#${buildNum}`;
    childrenTbody.innerHTML = `<tr class="loading-row"><td colspan="8">Cargando detalles…</td></tr>`;

    // Highlight row
    parentTbody.querySelectorAll("tr").forEach((tr) => tr.classList.remove("is-selected"));
    const link = parentTbody.querySelector(`[data-build="${buildNum}"]`);
    if (link) link.closest("tr")?.classList.add("is-selected");

    try {
      const detail = await loadBuildDetail(fileName);
      renderDetail(detail);
      detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      childrenTbody.innerHTML = `<tr><td colspan="8" class="empty-state">Error cargando ${escapeHtml(fileName)}: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function renderDetail(detail) {
    const status = detail.status || "UNKNOWN";
    const badge = $("#detail-status-badge");
    badge.textContent = statusLabel(status);
    badge.className = `badge ${statusClass(status)}`;

    const start = detail.timestamp || "—";
    const end = detail.endTime || "—";
    const duration = detail.duration ? `(${detail.duration})` : "";
    $("#detail-time-range").textContent = `${start}  →  ${end} ${duration}`.trim();

    $("#logs-path").textContent = LOGS_BASE;

    const children = detail.children || [];
    childrenTbody.innerHTML = "";

    if (!children.length) {
      childrenTbody.innerHTML = `<tr><td colspan="8" class="empty-state">Sin jobs hijos</td></tr>`;
      return;
    }

    const frag = document.createDocumentFragment();
    children.forEach((c) => {
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
            data-job="${escapeHtml(c.job)}">👁 Ver</button>
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
  }

  // ---------- Modal ----------
  function showLogModal(jobName, logFile) {
    modal.hidden = false;
    modalTitle.textContent = `Log – ${jobName}`;
    modalBody.textContent =
      `Archivo: ${LOGS_BASE}${logFile}\n\n` +
      `Nota: el navegador no puede leer archivos locales por seguridad.\n` +
      `Abre el archivo manualmente desde:\n${LOGS_BASE}${logFile}\n\n` +
      `Si sirves el dashboard desde Jenkins o un web server con acceso a /Log,\n` +
      `puedes extender dashboard.js para hacer fetch del log aquí.`;
  }

  function closeModal() {
    modal.hidden = true;
  }

  // ---------- Load index ----------
  async function loadDashboard() {
    try {
      indexData = await fetchJson(INDEX_URL);
      if (!Array.isArray(indexData)) indexData = [];

      // Ensure newest first
      indexData.sort((a, b) => Number(b.build) - Number(a.build));

      if (indexData.length && indexData[0].job) {
        $("#page-title").textContent = indexData[0].job;
      }

      updateStats();
      await renderParentTable();

      // Auto-select first build
      if (indexData.length && selectedBuild == null) {
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
        No se pudo cargar <code>index.json</code>.<br/>
        Asegúrate de abrir el dashboard vía HTTP (no file://) desde la carpeta Dashboard.<br/>
        Error: ${escapeHtml(e.message)}
      </td></tr>`;
    }
  }

  // ---------- Events ----------
  btnShowMore.addEventListener("click", async () => {
    visibleCount += PAGE_SIZE;
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
    alert(
      "Los logs de los jobs hijos están en:\n" +
        LOGS_BASE +
        "\n\nAbre esa carpeta en el servidor Jenkins para descargarlos."
    );
  });

  // Auto refresh
  setInterval(() => {
    cache = {};
    loadDashboard();
  }, REFRESH_MS);

  // Init
  loadDashboard();
})();
