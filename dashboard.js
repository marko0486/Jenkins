Sustituye solo deleteScheduleFromModal:

async function deleteScheduleFromModal() {
  if (!editingScheduleId) return;
  const name = document.getElementById('sf-name').value.trim();
  if (!name) return;
  if (!confirm(
    `Delete job "${name}"?\n\nThis removes it from scheduled-jobs.json and deletes all related folders/logs under data/scheduled, last-run and Log.`
  )) {
    return;
  }
  const errEl = document.getElementById('sf-error');
  try {
    const url = (CONFIG.SCHEDULE_DELETE_URL || CONFIG.SCHEDULE_SAVE_URL) +
      '?name=' + encodeURIComponent(name);
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'Delete failed');
    }
    closeScheduleModal();

    // Reload schedule UI + recompute failures so bell/FAILED drop to 0 if needed
    await openScheduledView(true);
    await refreshBellAndFailedStats();

    // If no failures left in last 24h, force-hide badge
    const now = Date.now();
    const h24 = 24 * 60 * 60 * 1000;
    const remaining =
      allBuilds.filter(b => {
        const t = parseTimestamp(b.timestamp);
        return t && now - t <= h24;
      }).reduce((s, b) => s + (b.failedCount || 0), 0) +
      cachedScheduledFailures.filter(f => f._sortKey && now - f._sortKey <= h24).length;

    if (remaining === 0) {
      bellCleared = false;
      updateBellBadge(0);
    }

    alert('Job deleted and all traces removed: ' + name);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.hidden = false;
  }
}
