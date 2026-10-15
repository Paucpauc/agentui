// Tabs and File Editor Lifecycle Management

import { state } from "./state.js";
import { dom } from "./dom.js";
import { getIconSvg, escapeHtml } from "./icons.js";
import { revealPathInTree } from "./fileTree.js";
import { sendResize } from "./terminal.js";
import {
  getFilePreviewType,
  canRunFile,
  renderTabPreview,
  exitFullscreenPreview
} from "./preview.js";
import { setupImageEditor } from "./imageEditor.js";

// Re-export sub-module functionality for seamless backwards compatibility
export {
  getEditorContent,
  setEditorContent,
  resizeAndFocusEditor,
  destroyEditor,
  createEditorContainer
} from "./editor.js";

export {
  setTabDirty,
  getTabIconName,
  createTabElement,
  createPaneElement,
  updateViewerHeaderActions,
  bindViewerHeaderActions
} from "./tabUi.js";

export {
  tabCheckTimers,
  normalizeTabPath,
  showDiskChangeBanner,
  hideDiskChangeBanner,
  reloadTabWithContent,
  checkDiskFileForTab,
  scheduleCheckTabOnDisk,
  handleFilesChangedOnDisk,
  checkOpenTabsAgainstTree
} from "./tabSync.js";

import {
  getEditorContent,
  setEditorContent,
  resizeAndFocusEditor,
  destroyEditor,
  createEditorContainer
} from "./editor.js";

import {
  setTabDirty,
  createTabElement,
  createPaneElement,
  bindViewerHeaderActions
} from "./tabUi.js";

import {
  tabCheckTimers,
  hideDiskChangeBanner
} from "./tabSync.js";

export function confirmDiscardUnsavedChanges() {
  const dirtyTabs = [];
  for (const tabInfo of state.openTabs.values()) {
    if (tabInfo.isDirty) {
      dirtyTabs.push(tabInfo.path || tabInfo.name);
    }
  }
  if (dirtyTabs.length === 0) return true;

  const msg = dirtyTabs.length === 1
    ? `You have unsaved changes in "${dirtyTabs[0]}". Switch workspace and discard changes?`
    : `You have unsaved changes in the following files:\n${dirtyTabs.map(f => `• ${f}`).join("\n")}\n\nSwitch workspace and discard changes?`;
  return confirm(msg);
}

export function closeAllTabs() {
  exitFullscreenPreview();
  for (const timer of tabCheckTimers.values()) {
    clearTimeout(timer);
  }
  tabCheckTimers.clear();
  for (const [tabId, tabInfo] of state.openTabs.entries()) {
    hideDiskChangeBanner(tabInfo);
    destroyEditor(tabInfo);
    if (tabInfo.tabElement) {
      tabInfo.tabElement.remove();
    }
    if (tabInfo.paneElement) {
      tabInfo.paneElement.remove();
    }
  }
  state.openTabs.clear();
  activateTab("terminal");
}

export async function setTabMode(tabInfo, mode) {
  if (!tabInfo.hasPreview && !tabInfo.canRun) return;
  if ((tabInfo.previewType === "office" || tabInfo.previewType === "pdf") && mode === "edit") {
    return;
  }
  tabInfo.mode = mode;

  const modeBtns = tabInfo.paneElement.querySelectorAll(".mode-toggle .btn-mode");
  modeBtns.forEach(btn => {
    if (btn.dataset.mode === mode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  const btnExpand = tabInfo.paneElement.querySelector(".btn-expand-iframe");
  if (btnExpand) {
    if (mode === "preview" || mode === "run") {
      btnExpand.style.display = "inline-flex";
    } else {
      btnExpand.style.display = "none";
      if (state.currentFullscreenTab === tabInfo) {
        exitFullscreenPreview();
      }
    }
  }

  if (!tabInfo.editorContainer || !tabInfo.previewContainer) {
    return;
  }

  if (mode === "preview" || mode === "run") {
    if (mode === "run" && tabInfo.isDirty) {
      await saveFile(tabInfo);
    }
    // If there were pending changes from disk and user was not dirty, apply before preview
    if (tabInfo.pendingDiskContent !== null && !tabInfo.isDirty) {
      tabInfo.originalContent = tabInfo.pendingDiskContent;
      setEditorContent(tabInfo, tabInfo.pendingDiskContent);
      setTabDirty(tabInfo, false);
      hideDiskChangeBanner(tabInfo);
    }
    if (tabInfo.previewType === "image" && tabInfo.imageEditor) {
      try {
        const curData = tabInfo.imageEditor.getDataUrl();
        if (curData) {
          tabInfo.currentContent = curData;
        }
      } catch (e) {}
    }
    tabInfo.editorContainer.style.display = "none";
    const isFlexPreview = tabInfo.previewType === "html" || tabInfo.previewType === "office" || tabInfo.previewType === "pdf" || (canRunFile(tabInfo.name) && mode === "run");
    if (isFlexPreview) {
      tabInfo.previewContainer.style.display = "flex";
      tabInfo.previewContainer.style.flexDirection = "column";
    } else {
      tabInfo.previewContainer.style.display = "block";
      tabInfo.previewContainer.style.flexDirection = "";
    }
    renderTabPreview(tabInfo, mode === "run");
  } else {
    tabInfo.previewContainer.style.display = "none";
    tabInfo.editorContainer.style.display = "flex";
    if (tabInfo.previewType === "image") {
      setupImageEditor(tabInfo, tabInfo.editorContainer);
    } else {
      resizeAndFocusEditor(tabInfo, 30);
    }
  }
}

export async function saveFile(tabInfo) {
  if (tabInfo.path && (tabInfo.path === ".backup" || tabInfo.path.startsWith(".backup/"))) {
    alert("Backup files are read-only and cannot be modified.");
    return;
  }
  if (tabInfo.isTruncated || tabInfo.previewType === "office" || tabInfo.previewType === "pdf") return;
  const ws = tabInfo.workspace || state.currentWorkspace;
  if (!ws) return;

  const saveBtn = tabInfo.saveBtn;
  const statusBadge = tabInfo.statusBadge;
  const contentToSave = getEditorContent(tabInfo);

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  statusBadge.textContent = "Saving...";
  statusBadge.className = "save-status show";

  try {
    const res = await fetch("/api/file-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: ws,
        path: tabInfo.path,
        content: contentToSave
      })
    });

    if (res.ok) {
      const savedData = await res.json().catch(() => ({}));
      tabInfo.originalContent = contentToSave;
      tabInfo.lastSavedTimestamp = Date.now();
      if (savedData && savedData.mtime) {
        tabInfo.lastKnownMtime = savedData.mtime;
      }
      if (savedData && savedData.size !== undefined) {
        tabInfo.lastKnownSize = savedData.size;
      }
      hideDiskChangeBanner(tabInfo);
      setTabDirty(tabInfo, false);
      statusBadge.innerHTML = `${getIconSvg("check")} <span>Saved</span>`;
      statusBadge.className = "save-status show saved";
      setTimeout(() => {
        if (!tabInfo.isDirty) {
          statusBadge.classList.remove("show");
        }
      }, 2500);

      if ((tabInfo.hasPreview || tabInfo.canRun) && (tabInfo.mode === "preview" || tabInfo.mode === "run")) {
        renderTabPreview(tabInfo, tabInfo.mode === "run");
      }
    } else {
      let errMsg = "Save failed";
      try {
        const errData = await res.json();
        if (errData && errData.detail) errMsg = errData.detail;
      } catch (e) {}
      statusBadge.innerHTML = `${getIconSvg("alert-triangle")} <span>${escapeHtml(errMsg)}</span>`;
      statusBadge.className = "save-status show error";
    }
  } catch (err) {
    statusBadge.innerHTML = `${getIconSvg("alert-triangle")} <span>Save failed</span>`;
    statusBadge.className = "save-status show error";
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `${getIconSvg("save")} <span>Save</span>`;
  }
}

async function loadTabContent(tabInfo) {
  const { tabId, paneElement: paneElem, path: filePath, previewType, canRun, hasPreview: canPreview } = tabInfo;
  const hasAltView = canPreview || canRun;

  try {
    const res = await fetch(`/api/file-content?workspace=${encodeURIComponent(state.currentWorkspace)}&path=${encodeURIComponent(filePath)}`);
    if (!res.ok) {
      let errMsg = "Could not read file";
      try {
        const errData = await res.json();
        if (errData && errData.detail) errMsg = errData.detail;
      } catch (e) {}
      throw new Error(errMsg);
    }
    const data = await res.json();
    if (!state.openTabs.has(tabId)) return;

    tabInfo.originalContent = data.content;
    tabInfo.currentContent = data.content;
    tabInfo.lastKnownMtime = data.mtime;
    tabInfo.lastKnownSize = data.size;
    tabInfo.isTruncated = Boolean(data.truncated);

    const bodyElem = paneElem.querySelector(".viewer-body");
    bodyElem.innerHTML = "";

    if (tabInfo.isTruncated) {
      const banner = document.createElement("div");
      banner.className = "warning-banner";
      banner.innerHTML = `${getIconSvg("alert-triangle")} <span>File is too large to edit (>2MB). Showing read-only view.</span>`;
      bodyElem.appendChild(banner);
      if (tabInfo.saveBtn) {
        tabInfo.saveBtn.disabled = true;
        tabInfo.saveBtn.title = "Save disabled: file too large";
      }
    }

    const isBackupFile = Boolean(filePath && (filePath === ".backup" || filePath.startsWith(".backup/")));
    if (isBackupFile) {
      tabInfo.isReadOnly = true;
      if (tabInfo.saveBtn) {
        tabInfo.saveBtn.disabled = true;
        tabInfo.saveBtn.style.display = "none";
      }
      const backupBanner = document.createElement("div");
      backupBanner.className = "info-banner backup-banner";
      backupBanner.innerHTML = `${getIconSvg("shield")} <span>Backup file is read-only. Editing and renaming are disabled.</span>`;
      bodyElem.appendChild(backupBanner);
    }

    // Editor Container setup
    const editorContainer = createEditorContainer(tabInfo, data.content, {
      onDirty: (dirty) => setTabDirty(tabInfo, dirty),
      onSave: () => saveFile(tabInfo)
    });
    bodyElem.appendChild(editorContainer);
    tabInfo.editorContainer = editorContainer;

    // Preview Container if file supports preview or run
    if (hasAltView) {
      const previewContainer = document.createElement("div");
      previewContainer.className = "preview-container" +
        (previewType === "markdown" ? " markdown-content" : "") +
        (previewType === "html" || canRun ? " preview-html-container" : "") +
        (previewType === "office" ? " office-preview-container" : "") +
        (previewType === "pdf" ? " pdf-preview-container" : "");
      previewContainer.dataset.basePath = filePath;
      bodyElem.appendChild(previewContainer);
      tabInfo.previewContainer = previewContainer;
    }

    // Bind all header action buttons
    bindViewerHeaderActions(tabInfo, {
      onSave: (info) => saveFile(info),
      onModeChange: (info, mode) => setTabMode(info, mode)
    });

    // Default to preview mode if file has preview
    if (canPreview && tabInfo.mode === "preview") {
      editorContainer.style.display = "none";
      if (tabInfo.previewContainer) {
        const isFlexPreview = tabInfo.previewType === "html" || tabInfo.previewType === "office" || tabInfo.previewType === "pdf";
        tabInfo.previewContainer.style.display = isFlexPreview ? "flex" : "block";
        tabInfo.previewContainer.style.flexDirection = isFlexPreview ? "column" : "";
        renderTabPreview(tabInfo, false);
      }
    } else {
      editorContainer.style.display = "flex";
      if (tabInfo.previewContainer) {
        tabInfo.previewContainer.style.display = "none";
      }
    }
  } catch (err) {
    if (!state.openTabs.has(tabId)) return;
    const bodyElem = paneElem.querySelector(".viewer-body");
    bodyElem.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

export async function openFile(filePath, fileName) {
  if (!fileName) {
    fileName = filePath.split("/").pop() || filePath;
  }
  revealPathInTree(filePath);

  const tabId = "file:" + filePath;
  if (state.openTabs.has(tabId)) {
    activateTab(tabId);
    return;
  }

  const previewType = getFilePreviewType(fileName);
  const canPreview = previewType !== null;
  const canRun = canRunFile(fileName);
  const initialMode = canPreview ? "preview" : "edit";

  // Create Tab button in the tab bar
  const { tabElem, titleElement } = createTabElement({
    tabId,
    filePath,
    fileName,
    previewType,
    onClose: (id) => closeTab(id)
  });
  dom.tabsBar.appendChild(tabElem);

  // Create View Pane in the views container
  const paneElem = createPaneElement({
    tabId,
    filePath,
    fileName,
    previewType,
    canRun,
    initialMode
  });
  dom.tabViewsContainer.appendChild(paneElem);

  const tabInfo = {
    tabId,
    tabElement: tabElem,
    paneElement: paneElem,
    titleElement,
    path: filePath,
    name: fileName,
    workspace: state.currentWorkspace,
    hasPreview: canPreview,
    canRun,
    previewType,
    isMd: previewType === "markdown",
    originalContent: "",
    currentContent: "",
    isDirty: false,
    mode: initialMode,
    isTruncated: false,
    editor: null,
    textarea: null,
    previewContainer: null,
    editorContainer: null,
    statusBadge: paneElem.querySelector(".save-status"),
    saveBtn: paneElem.querySelector(".btn-save"),
    imageEditor: null,
    pendingDiskContent: null,
    diskChangeBanner: null,
    lastSavedTimestamp: 0,
    lastKnownMtime: 0,
    lastKnownSize: 0
  };

  state.openTabs.set(tabId, tabInfo);
  activateTab(tabId);

  await loadTabContent(tabInfo);
}

export function activateTab(tabId) {
  if (state.currentFullscreenTab && state.currentFullscreenTab.tabId !== tabId) {
    exitFullscreenPreview();
  }
  state.activeTabId = tabId;

  // Tabs header
  document.querySelectorAll(".tab").forEach(t => {
    if (t.dataset.tabId === tabId) {
      t.classList.add("active");
    } else {
      t.classList.remove("active");
    }
  });

  // Tab panes
  document.querySelectorAll(".tab-pane").forEach(p => {
    p.classList.remove("active");
  });

  if (tabId === "terminal") {
    const paneTerm = document.getElementById("pane-terminal");
    if (paneTerm) paneTerm.classList.add("active");
    if (state.fitAddon) {
      setTimeout(() => {
        state.fitAddon.fit();
        sendResize();
        if (state.term) state.term.focus();
      }, 50);
    }
  } else {
    const tabInfo = state.openTabs.get(tabId);
    if (tabInfo && tabInfo.paneElement) {
      tabInfo.paneElement.classList.add("active");
      resizeAndFocusEditor(tabInfo, 50);
    }
  }
}

export function closeTab(tabId, force = false) {
  const tabInfo = state.openTabs.get(tabId);
  if (!tabInfo) return;

  if (state.currentFullscreenTab && state.currentFullscreenTab.tabId === tabId) {
    exitFullscreenPreview();
  }

  if (!force && tabInfo.isDirty) {
    const ok = confirm(`You have unsaved changes in "${tabInfo.name}". Close anyway?`);
    if (!ok) return;
  }

  if (tabCheckTimers.has(tabId)) {
    clearTimeout(tabCheckTimers.get(tabId));
    tabCheckTimers.delete(tabId);
  }
  hideDiskChangeBanner(tabInfo);
  destroyEditor(tabInfo);

  if (tabInfo.tabElement) tabInfo.tabElement.remove();
  if (tabInfo.paneElement) tabInfo.paneElement.remove();
  state.openTabs.delete(tabId);

  if (state.activeTabId === tabId) {
    activateTab("terminal");
  }
}

// Window resize listener to keep active Ace editor properly sized
window.addEventListener("resize", () => {
  if (state.activeTabId && state.activeTabId !== "terminal") {
    const tabInfo = state.openTabs.get(state.activeTabId);
    if (tabInfo && tabInfo.editor && tabInfo.mode === "edit") {
      tabInfo.editor.resize();
    }
  }
});
