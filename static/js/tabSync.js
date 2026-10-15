// Tab Disk Synchronization and Conflict Handling

import { state } from "./state.js";
import { getIconSvg } from "./icons.js";
import { renderTabPreview } from "./preview.js";
import { setTabDirty } from "./tabUi.js";
import { setEditorContent } from "./editor.js";

export const tabCheckTimers = new Map();

/**
 * Normalizes file paths for tab comparison (stripping leading/trailing slashes).
 */
export function normalizeTabPath(pathStr) {
  if (!pathStr || typeof pathStr !== "string") return "";
  return pathStr.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Displays an on-screen warning banner when a file has changed on disk while open.
 */
export function showDiskChangeBanner(tabInfo, newContent) {
  if (!tabInfo || !tabInfo.paneElement) return;
  tabInfo.pendingDiskContent = newContent;

  if (tabInfo.diskChangeBanner && tabInfo.paneElement.contains(tabInfo.diskChangeBanner)) {
    return;
  }

  const banner = document.createElement("div");
  banner.className = "file-changed-banner";
  banner.innerHTML = `
    <div class="file-changed-banner-message">
      ${getIconSvg("alert-triangle")}
      <span>File was modified on disk.</span>
    </div>
    <div class="file-changed-banner-actions">
      <button class="btn-banner-reload" type="button" title="Reload file in editor">
        ${getIconSvg("refresh")} <span>Reload</span>
      </button>
      <button class="btn-banner-dismiss" type="button" title="Ignore changes">
        <span>Ignore</span>
      </button>
    </div>
  `;

  const btnReload = banner.querySelector(".btn-banner-reload");
  if (btnReload) {
    btnReload.addEventListener("click", () => {
      if (tabInfo.isDirty) {
        const ok = confirm("Editor has unsaved changes. Reload file from disk?");
        if (!ok) return;
      }
      const contentToApply = tabInfo.pendingDiskContent !== null ? tabInfo.pendingDiskContent : newContent;
      reloadTabWithContent(tabInfo, contentToApply);
    });
  }

  const btnDismiss = banner.querySelector(".btn-banner-dismiss");
  if (btnDismiss) {
    btnDismiss.addEventListener("click", () => {
      hideDiskChangeBanner(tabInfo);
    });
  }

  const bodyElem = tabInfo.paneElement.querySelector(".viewer-body");
  if (bodyElem) {
    if (tabInfo.editorContainer && bodyElem.contains(tabInfo.editorContainer)) {
      bodyElem.insertBefore(banner, tabInfo.editorContainer);
    } else {
      bodyElem.prepend(banner);
    }
  }

  tabInfo.diskChangeBanner = banner;
  if (tabInfo.editor) {
    setTimeout(() => tabInfo.editor.resize(), 20);
  }
}

/**
 * Hides and removes the disk conflict banner for a tab.
 */
export function hideDiskChangeBanner(tabInfo) {
  if (!tabInfo) return;
  tabInfo.pendingDiskContent = null;
  if (tabInfo.diskChangeBanner) {
    tabInfo.diskChangeBanner.remove();
    tabInfo.diskChangeBanner = null;
    if (tabInfo.editor) {
      setTimeout(() => tabInfo.editor.resize(), 20);
    }
  }
}

/**
 * Reloads a tab with newly fetched content from disk, updating UI and preview.
 */
export function reloadTabWithContent(tabInfo, newContent) {
  if (!tabInfo) return;
  tabInfo.originalContent = newContent;
  setEditorContent(tabInfo, newContent);
  setTabDirty(tabInfo, false);
  hideDiskChangeBanner(tabInfo);

  if ((tabInfo.hasPreview || tabInfo.canRun) && (tabInfo.mode === "preview" || tabInfo.mode === "run")) {
    const container = tabInfo.previewContainer;
    const prevScroll = container ? container.scrollTop : 0;
    renderTabPreview(tabInfo, tabInfo.mode === "run");
    if (container) {
      container.scrollTop = prevScroll;
    }
  }

  if (tabInfo.statusBadge) {
    tabInfo.statusBadge.innerHTML = `${getIconSvg("check")} <span>Reloaded</span>`;
    tabInfo.statusBadge.className = "save-status show saved";
    setTimeout(() => {
      if (!tabInfo.isDirty) {
        tabInfo.statusBadge.classList.remove("show");
      }
    }, 2000);
  }
}

/**
 * Queries server for the file on disk corresponding to a tab and reconciles changes.
 */
export async function checkDiskFileForTab(tabInfo) {
  if (!tabInfo || !tabInfo.path) return;
  if (tabInfo.lastSavedTimestamp && (Date.now() - tabInfo.lastSavedTimestamp < 1500)) {
    return;
  }

  const ws = tabInfo.workspace || state.currentWorkspace;
  if (!ws) return;

  try {
    const res = await fetch(`/api/file-content?workspace=${encodeURIComponent(ws)}&path=${encodeURIComponent(tabInfo.path)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!state.openTabs.has(tabInfo.tabId)) return;

    tabInfo.lastKnownMtime = data.mtime;
    tabInfo.lastKnownSize = data.size;
    const diskContent = data.content;

    // If disk content is already identical to what tab has, nothing to change
    if (diskContent === tabInfo.currentContent && diskContent === tabInfo.originalContent) {
      hideDiskChangeBanner(tabInfo);
      return;
    }

    if (tabInfo.mode === "preview" || tabInfo.mode === "run") {
      // Preview mode: auto-refresh immediately
      if (diskContent !== tabInfo.currentContent) {
        reloadTabWithContent(tabInfo, diskContent);
      }
    } else {
      // Source mode: show prompt / notification that file was changed and offer to reload
      if (diskContent !== tabInfo.currentContent) {
        showDiskChangeBanner(tabInfo, diskContent);
      } else {
        hideDiskChangeBanner(tabInfo);
        tabInfo.originalContent = diskContent;
        setTabDirty(tabInfo, false);
      }
    }
  } catch (err) {
    console.warn("Failed to check disk file for tab:", tabInfo.path, err);
  }
}

/**
 * Debounced check of a tab against disk with a given delay in milliseconds.
 */
export function scheduleCheckTabOnDisk(tabInfo, delay = 150) {
  if (!tabInfo || !tabInfo.tabId) return;
  if (tabCheckTimers.has(tabInfo.tabId)) {
    clearTimeout(tabCheckTimers.get(tabInfo.tabId));
  }
  const timer = setTimeout(() => {
    tabCheckTimers.delete(tabInfo.tabId);
    checkDiskFileForTab(tabInfo);
  }, delay);
  tabCheckTimers.set(tabInfo.tabId, timer);
}

/**
 * Handles batch file change notifications from the file watcher WebSocket.
 */
export function handleFilesChangedOnDisk(changes) {
  if (!state.currentWorkspace) return;
  const currentWs = state.currentWorkspace;

  let changedSet = null;
  if (Array.isArray(changes) && changes.length > 0) {
    changedSet = new Set();
    for (const c of changes) {
      const p = typeof c === "string" ? c : (c && c.path);
      if (p) {
        changedSet.add(normalizeTabPath(p));
      }
    }
  }

  for (const tabInfo of state.openTabs.values()) {
    if (!tabInfo || !tabInfo.path) continue;
    const ws = tabInfo.workspace || currentWs;
    if (ws !== currentWs) continue;

    const normTabPath = normalizeTabPath(tabInfo.path);
    if (!changedSet || changedSet.has(normTabPath)) {
      scheduleCheckTabOnDisk(tabInfo, 150);
    }
  }
}

/**
 * Compares all open tabs against the refreshed file tree to detect out-of-band changes.
 */
export function checkOpenTabsAgainstTree(tree) {
  if (!tree || !state.currentWorkspace || state.openTabs.size === 0) return;
  const treeMap = new Map();

  function collect(nodes) {
    for (const n of nodes) {
      if (n.is_dir && n.children) {
        collect(n.children);
      } else if (!n.is_dir) {
        treeMap.set(normalizeTabPath(n.path), n);
      }
    }
  }
  collect(tree);

  for (const tabInfo of state.openTabs.values()) {
    if (!tabInfo || !tabInfo.path) continue;
    const norm = normalizeTabPath(tabInfo.path);
    const node = treeMap.get(norm);
    if (node) {
      const mtimeChanged = tabInfo.lastKnownMtime !== undefined && node.mtime !== undefined && node.mtime > tabInfo.lastKnownMtime;
      const sizeChanged = tabInfo.lastKnownSize !== undefined && node.size !== undefined && node.size !== tabInfo.lastKnownSize;
      if (mtimeChanged || sizeChanged) {
        scheduleCheckTabOnDisk(tabInfo, 150);
      }
    }
  }
}
