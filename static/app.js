// Agent Web UI - Main Application Entrypoint & Coordinator

import { state } from "./js/state.js";
import { dom } from "./js/dom.js";
import { UI_ICONS, getIconSvg, escapeHtml } from "./js/icons.js";
import { initTerminal, sendResize, connectPty, isExecutableFile, executeFileInTty } from "./js/terminal.js";
import {
  getWorkspaceFromUrl,
  updateUrl,
  loadWorkspaces,
  selectWorkspace,
  createWorkspace,
  deleteWorkspace,
  renameWorkspace,
  openWorkspaceModal,
  closeWorkspaceModal,
  renderModalWorkspaces,
  initWorkspaceModal
} from "./js/workspace.js";
import {
  connectFileWatcher,
  disconnectFileWatcher,
  scheduleLoadFiles,
  startFilePolling
} from "./js/fileWatcher.js";
import {
  formatZipFileSize,
  downloadWorkspaceZip,
  openUploadModal,
  closeUploadModal,
  setUploadZipFile,
  uploadWorkspaceZip,
  initWorkspaceZipModal
} from "./js/workspaceZip.js";
import {
  formatFileSize,
  openUploadFilesModal,
  closeUploadFilesModal,
  addFilesToUpload,
  removeFileFromUpload,
  renderSelectedUploadFiles,
  submitUploadFiles,
  initFileUploadModal
} from "./js/fileUpload.js";
import {
  openShareLinkModal,
  closeShareLinkModal,
  generateAndDisplayShareLink,
  initShareModal
} from "./js/shareModal.js";
import {
  loadFiles,
  renderFileTree,
  toggleNewFileForm,
  hideNewFileForm,
  createNewFile,
  showContextMenu,
  hideContextMenu,
  startInlineRename,
  doRenameFile,
  doDeleteFile,
  handleFileRenamed,
  handleFileDeleted,
  revealPathInTree,
  isDirCollapsed,
  doRestoreBackup,
  createQuickBackup,
  initFileTreeEvents
} from "./js/fileTree.js";
import {
  DOMPURIFY_CONFIG,
  initMarkdownParser,
  normalizePath,
  parseMarkdownLink,
  scrollToAnchorInContainer,
  scrollToHashInTab,
  handleMarkdownLinkClick,
  renderMarkdown,
  renderMermaidDiagrams,
  renderFlowchartJsDiagrams
} from "./js/markdown.js";
import {
  getFilePreviewType,
  hasPreview,
  canRunFile,
  getFileTypeLabel,
  renderHtmlPreview,
  renderJsRunner,
  renderSvgPreview,
  renderTabPreview,
  isFullscreenPreviewActive,
  enterFullscreenPreview,
  exitFullscreenPreview,
  toggleFullscreenPreview
} from "./js/preview.js";
import {
  setTabDirty,
  setTabMode,
  openFile,
  activateTab,
  closeTab,
  closeAllTabs,
  confirmDiscardUnsavedChanges,
  saveFile,
  updateViewerHeaderActions,
  showDiskChangeBanner,
  hideDiskChangeBanner,
  reloadTabWithContent,
  checkDiskFileForTab,
  handleFilesChangedOnDisk,
  checkOpenTabsAgainstTree
} from "./js/tabs.js";
import { checkAuthStatus, setupFetchInterceptor } from "./js/auth.js";
import { initLimits, fetchLimits, updateLimitsUI } from "./js/limits.js";

// Re-export core modules for external or programmatic access
export * from "./js/icons.js";
export * from "./js/state.js";
export * from "./js/dom.js";
export * from "./js/terminal.js";
export * from "./js/workspace.js";
export * from "./js/fileWatcher.js";
export * from "./js/workspaceZip.js";
export * from "./js/fileUpload.js";
export * from "./js/shareModal.js";
export * from "./js/fileTree.js";
export * from "./js/markdown.js";
export * from "./js/preview.js";
export * from "./js/imageEditor.js";
export * from "./js/editor.js";
export * from "./js/tabUi.js";
export * from "./js/tabSync.js";
export * from "./js/tabs.js";
export * from "./js/auth.js";
export * from "./js/limits.js";


// Setup HTTP fetch 401 interceptor
setupFetchInterceptor();

// Global Ctrl+S / Cmd+S save shortcut
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (state.activeTabId && state.activeTabId.startsWith("file:")) {
      const tabInfo = state.openTabs.get(state.activeTabId);
      if (tabInfo) {
        saveFile(tabInfo);
      }
    }
  }
});

// Global Escape key listener to exit fullscreen iframe preview
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.currentFullscreenTab) {
      e.preventDefault();
      exitFullscreenPreview();
    }
  }
});

// Clamp floating button inside viewport on window resize
window.addEventListener("resize", () => {
  if (state.currentFullscreenTab && state.currentFullscreenTab.previewContainer) {
    const floatingBtn = state.currentFullscreenTab.previewContainer.querySelector(".floating-exit-fullscreen-btn");
    if (floatingBtn && floatingBtn.style.left) {
      const rect = floatingBtn.getBoundingClientRect();
      const padding = 10;
      let newLeft = Math.max(padding, Math.min(window.innerWidth - rect.width - padding, rect.left));
      let newTop = Math.max(padding, Math.min(window.innerHeight - rect.height - padding, rect.top));
      floatingBtn.style.left = `${newLeft}px`;
      floatingBtn.style.top = `${newTop}px`;
    }
  }
});

// Event Listeners: tabs bar delegation for terminal and file tabs
if (dom.tabsBar) {
  dom.tabsBar.addEventListener("click", (e) => {
    const tabElem = e.target.closest(".tab");
    if (!tabElem) return;
    if (e.target.classList.contains("tab-close")) return;
    const tabId = tabElem.dataset.tabId;
    if (tabId) {
      activateTab(tabId);
    }
  });
}

// Event Listener: delegation for markdown links in previews
if (dom.tabViewsContainer) {
  dom.tabViewsContainer.addEventListener("click", async (e) => {
    const anchor = e.target.closest("a");
    if (!anchor) return;
    const previewContainer = anchor.closest(".markdown-content");
    if (!previewContainer) return;
    await handleMarkdownLinkClick(e, anchor, previewContainer);
  });
}

// Workspace selection and navigation
if (dom.wsSelect) {
  dom.wsSelect.onchange = (e) => {
    if (e.target.value) {
      selectWorkspace(e.target.value, false, "push");
    }
  };
}

window.addEventListener("popstate", () => {
  const urlWs = getWorkspaceFromUrl();
  const wsSelect = dom.wsSelect;
  if (!wsSelect) return;

  if (urlWs) {
    if (urlWs !== state.currentWorkspace) {
      const exists = Array.from(wsSelect.options).some(opt => opt.value === urlWs);
      if (exists) {
        selectWorkspace(urlWs, false, "none");
      }
    }
  } else if (state.currentWorkspace && wsSelect.options.length > 1) {
    const firstWs = wsSelect.options[1].value;
    if (firstWs && firstWs !== state.currentWorkspace) {
      selectWorkspace(firstWs, false, "none");
    }
  }
});

if (dom.btnRefreshWs) dom.btnRefreshWs.onclick = () => loadWorkspaces();
if (dom.btnRefreshFiles) dom.btnRefreshFiles.onclick = () => loadFiles(true);
if (dom.btnQuickBackup) dom.btnQuickBackup.onclick = () => createQuickBackup();
if (dom.btnCreateWs) dom.btnCreateWs.onclick = createWorkspace;
if (dom.newWsInput) {
  dom.newWsInput.onkeydown = (e) => {
    if (e.key === "Enter") createWorkspace();
  };
}

// Visibility change handler for auto-refresh on returning to tab
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.currentWorkspace) {
    loadFiles();
    if (!state.fileWatcherSocket || state.fileWatcherSocket.readyState !== WebSocket.OPEN) {
      connectFileWatcher();
    }
  }
});

// File Explorer drag-drop handler for files upload
const fileExplorerSec = dom.fileExplorerSec;
if (fileExplorerSec) {
  fileExplorerSec.addEventListener("dragover", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some(item => item.kind === "file")) {
      e.preventDefault();
      fileExplorerSec.classList.add("dragover");
    }
  });

  fileExplorerSec.addEventListener("dragleave", (e) => {
    if (!fileExplorerSec.contains(e.relatedTarget)) {
      fileExplorerSec.classList.remove("dragover");
    }
  });

  fileExplorerSec.addEventListener("drop", (e) => {
    fileExplorerSec.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (state.currentWorkspace) {
        e.preventDefault();
        openUploadFilesModal({}, e.dataTransfer.files);
      }
    }
  });
}

// Sidebar drag-drop handler for quick workspace zip or files upload
const sidebarEl = dom.sidebarEl;
if (sidebarEl) {
  sidebarEl.addEventListener("dragover", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some(item => item.kind === "file")) {
      e.preventDefault();
    }
  });

  sidebarEl.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith(".zip") && (!e.target || !e.target.closest || !e.target.closest(".file-explorer-sec"))) {
        e.preventDefault();
        openUploadModal(file);
      } else if (state.currentWorkspace && (!e.target || !e.target.closest || !e.target.closest(".file-explorer-sec"))) {
        e.preventDefault();
        openUploadFilesModal({}, e.dataTransfer.files);
      }
    }
  });
}

// Initialize modals and handlers
initWorkspaceModal();
initWorkspaceZipModal();
initFileUploadModal();
initShareModal();
initFileTreeEvents();

// Initial application bootstrap
function initApp() {
  checkAuthStatus();
  initMarkdownParser();
  const urlWs = getWorkspaceFromUrl();
  if (urlWs) {
    state.currentWorkspace = urlWs;
    loadFiles();
    connectFileWatcher();
  }
  initTerminal();
  loadWorkspaces();
  startFilePolling();
  initLimits();
}


if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
