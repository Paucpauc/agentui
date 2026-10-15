// Agent Web UI - Limits Tracker & Display Coordinator

import { dom } from "./dom.js";
import { escapeHtml } from "./icons.js";

let pollingInterval = null;
let currentLimitsData = null;

function getPercentClass(percent) {
  if (percent >= 50) return "limit-ok";
  if (percent >= 20) return "limit-warn";
  return "limit-danger";
}

function formatRelativeReset(resetTimeStr) {
  if (!resetTimeStr) return "";
  try {
    const target = new Date(resetTimeStr);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    if (diffMs <= 0) return "resets now";

    const diffMins = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;

    if (days > 0) {
      return `resets in ${days}d ${remHours}h`;
    }
    if (hours > 0) {
      return `resets in ${hours}h ${mins}m`;
    }
    return `resets in ${mins}m`;
  } catch (e) {
    return "";
  }
}

function formatAbsoluteTime(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (e) {
    return isoStr;
  }
}

export function updateLimitsUI(data) {
  if (!data) return;
  currentLimitsData = data;

  const limit5hVal = dom.limit5hVal;
  const limitWeeklyVal = dom.limitWeeklyVal;
  const limit5hBadge = dom.limit5hBadge;
  const limitWeeklyBadge = dom.limitWeeklyBadge;
  const limitsLastUpdated = dom.limitsLastUpdated;
  const limitsGroupsList = dom.limitsGroupsList;

  // Check if primary summary is available
  if (data.primary) {
    const fiveH = data.primary.five_hour;
    const weekly = data.primary.weekly;

    if (limit5hVal && fiveH) {
      const p5 = typeof fiveH.percent === "number" ? fiveH.percent : 0;
      limit5hVal.textContent = `${p5}%`;
      limit5hVal.className = `limit-val ${getPercentClass(p5)}`;
      if (limit5hBadge) {
        const resetHint = formatRelativeReset(fiveH.reset_time);
        limit5hBadge.title = `5-hour remaining: ${p5}%${resetHint ? ` (${resetHint})` : ""}`;
      }
    }

    if (limitWeeklyVal && weekly) {
      const pw = typeof weekly.percent === "number" ? weekly.percent : 0;
      limitWeeklyVal.textContent = `${pw}%`;
      limitWeeklyVal.className = `limit-val ${getPercentClass(pw)}`;
      if (limitWeeklyBadge) {
        const resetHint = formatRelativeReset(weekly.reset_time);
        limitWeeklyBadge.title = `Weekly remaining: ${pw}%${resetHint ? ` (${resetHint})` : ""}`;
      }
    }
  } else if (data.status === "error") {
    if (limit5hVal) {
      limit5hVal.textContent = "err";
      limit5hVal.className = "limit-val limit-danger";
    }
    if (limitWeeklyVal) {
      limitWeeklyVal.textContent = "err";
      limitWeeklyVal.className = "limit-val limit-danger";
    }
  }

  // Update dropdown detailed list
  if (limitsLastUpdated) {
    if (data.updated_at) {
      limitsLastUpdated.textContent = `Updated: ${formatAbsoluteTime(data.updated_at)}`;
    } else {
      limitsLastUpdated.textContent = "Waiting for update...";
    }
  }

  if (limitsGroupsList && Array.isArray(data.groups)) {
    if (data.groups.length === 0) {
      limitsGroupsList.innerHTML = `<div class="limits-empty-msg">${escapeHtml(data.error || "Limits not loaded yet")}</div>`;
    } else {
      let html = "";
      for (const group of data.groups) {
        const gName = escapeHtml(group.name || "Model Group");
        const gDesc = escapeHtml(group.description || "");

        html += `<div class="limits-group-card">`;
        html += `<div class="limits-group-title">${gName}</div>`;
        if (gDesc) {
          html += `<div class="limits-group-desc">${gDesc}</div>`;
        }

        const buckets = group.buckets || [];
        for (const bucket of buckets) {
          const bName = escapeHtml(bucket.name || bucket.window || "Limit");
          const percent = typeof bucket.percent === "number" ? bucket.percent : 0;
          const pClass = getPercentClass(percent);
          const resetRel = formatRelativeReset(bucket.reset_time);

          html += `
            <div class="limit-row">
              <div class="limit-row-info">
                <span class="limit-row-name">${bName}</span>
                <span class="limit-row-percent ${pClass}">${percent}%</span>
              </div>
              <div class="limit-progress-bar">
                <div class="limit-progress-fill ${pClass}" style="width: ${percent}%;"></div>
              </div>
              ${resetRel ? `<div class="limit-row-reset">${escapeHtml(resetRel)}</div>` : ""}
            </div>
          `;
        }
        html += `</div>`;
      }
      limitsGroupsList.innerHTML = html;
    }
  }
}

export async function fetchLimits(forceRefresh = false) {
  const btn = dom.btnRefreshLimits;
  if (btn) {
    btn.classList.add("loading");
    btn.disabled = true;
  }

  try {
    const url = forceRefresh ? "/api/limits?refresh=true" : "/api/limits";
    const method = forceRefresh ? "POST" : "GET";
    const postUrl = forceRefresh ? "/api/limits/refresh" : "/api/limits";

    const res = await fetch(postUrl, {
      method: method,
      headers: { "Accept": "application/json" }
    });

    if (res.ok) {
      const data = await res.json();
      updateLimitsUI(data);
    } else {
      console.warn("Failed to fetch limits:", res.status, res.statusText);
    }
  } catch (err) {
    console.warn("Error fetching limits:", err);
  } finally {
    if (btn) {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  }
}

export function initLimits() {
  const container = dom.limitsContainer;
  const btn = dom.btnRefreshLimits;
  const dropdown = dom.limitsDropdown;

  if (btn) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      fetchLimits(true);
    });
  }

  if (container && dropdown) {
    // Toggle dropdown on container click (excluding button)
    container.addEventListener("click", (e) => {
      if (e.target.closest("#btn-refresh-limits")) return;
      const isOpen = dropdown.style.display === "block";
      dropdown.style.display = isOpen ? "none" : "block";
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!container.contains(e.target)) {
        dropdown.style.display = "none";
      }
    });
  }

  // Initial fetch
  fetchLimits(false);

  // Poll every 60 seconds to reflect Python background updates (which run every 20m)
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    fetchLimits(false);
  }, 60000);
}
