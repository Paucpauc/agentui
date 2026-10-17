// Tab and Pane UI Construction and Header Actions

import { state } from "./state.js";
import { getIconSvg, escapeHtml } from "./icons.js";
import { getFileTypeLabel, toggleFullscreenPreview } from "./preview.js";
import { isExecutableFile, executeFileInTty } from "./terminal.js";
import { openShareLinkModal } from "./shareModal.js";
import { doRenameFile, doDeleteFile, doRestoreBackup } from "./fileTree.js";

/**
 * Updates dirty state indicator on a tab's header and badge.
 */
export function setTabDirty(tabInfo, dirty) {
  tabInfo.isDirty = dirty;
  if (dirty) {
    tabInfo.tabElement.classList.add("dirty");
    tabInfo.statusBadge.textContent = "Unsaved";
    tabInfo.statusBadge.className = "save-status show modified";
  } else {
    tabInfo.tabElement.classList.remove("dirty");
    tabInfo.statusBadge.className = "save-status";
  }
}

/**
 * Determines appropriate icon name for a given file name and preview type.
 */
export function getTabIconName(fileName, previewType) {
  if (previewType === "markdown") return "file-text";
  if (previewType === "html") return "globe";
  if (previewType === "svg" || previewType === "image") return "image";
  if (previewType === "office" || previewType === "pdf") return "file-text";

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".js") || lower.endsWith(".py") || lower.endsWith(".sh") || lower.endsWith(".bash")) {
    return "code";
  }
  return "file";
}

/**
 * Creates the DOM element for a tab button in the top tabs bar.
 */
export function createTabElement({ tabId, filePath, fileName, previewType, onClose }) {
  const tabElem = document.createElement("div");
  tabElem.className = "tab";
  tabElem.dataset.tabId = tabId;

  const icon = document.createElement("span");
  icon.className = "tab-icon";
  icon.innerHTML = getIconSvg(getTabIconName(fileName, previewType));

  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = fileName;
  title.title = filePath;

  const closeBtn = document.createElement("span");
  closeBtn.className = "tab-close";
  closeBtn.innerHTML = getIconSvg("close");
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    if (onClose) onClose(tabId);
  };

  tabElem.appendChild(icon);
  tabElem.appendChild(title);
  tabElem.appendChild(closeBtn);
  return { tabElem, titleElement: title };
}

/**
 * Creates the outer viewer pane DOM element for a file tab.
 */
export function createPaneElement({ tabId, filePath, fileName, previewType, canRun, initialMode }) {
  const paneElem = document.createElement("div");
  paneElem.className = "tab-pane file-viewer-pane";
  paneElem.id = "pane-" + CSS.escape(tabId);

  const canPreview = previewType !== null;
  const hasAltView = canPreview || canRun;
  const normPath = (filePath || "").replace(/\\/g, "/");
  const isBackupFile = Boolean(normPath.startsWith(".backup/"));

  paneElem.innerHTML = `
    <div class="viewer-header">
      <div class="viewer-header-left">
        <span class="viewer-filepath" title="${escapeHtml(filePath)}">${escapeHtml(filePath)}</span>
        <span class="file-type-badge">${escapeHtml(getFileTypeLabel(fileName))}</span>
        ${isBackupFile ? `<span class="badge badge-backup-readonly">Backup (Read-only)</span>` : ''}
        <span class="save-status"></span>
      </div>
      <div class="viewer-header-actions">
        ${hasAltView ? `
          <div class="btn-group mode-toggle">
            ${previewType !== 'office' && previewType !== 'pdf' ? `
              <button class="btn-mode ${initialMode === 'edit' ? 'active' : ''}" data-mode="edit" title="${previewType === 'image' ? 'Image editor' : 'Source editor'}">${previewType === 'image' ? 'Editor' : 'Source'}</button>
            ` : ''}
            ${canPreview ? `
              <button class="btn-mode ${initialMode === 'preview' ? 'active' : ''}" data-mode="preview" title="${previewType === 'office' ? 'Microsoft 365 Preview' : (previewType === 'pdf' ? 'PDF Preview' : 'Preview')}">Preview</button>
            ` : ''}
            ${canRun ? `
              <button class="btn-mode btn-run ${initialMode === 'run' ? 'active' : ''}" data-mode="run" title="Run with JavaScript enabled (isolated sandbox)">${getIconSvg("play")} <span>Run</span></button>
            ` : ''}
          </div>
        ` : ''}
        ${(previewType === 'html' || previewType === 'office' || previewType === 'pdf' || canRun) ? `
          <button class="btn-icon btn-expand-iframe" title="Expand to full browser" style="${initialMode === 'edit' ? 'display: none;' : ''}">${getIconSvg("maximize")} <span>Fullscreen</span></button>
        ` : ''}
        ${isExecutableFile(fileName) && !isBackupFile ? `
          <button class="btn-icon btn-execute-file" title="Execute in Agent TTY">${getIconSvg("zap")} <span>Execute</span></button>
        ` : ''}
        <a class="btn-icon btn-download-file-header" href="/api/files/raw?workspace=${encodeURIComponent(state.currentWorkspace)}&path=${encodeURIComponent(filePath)}" download="${escapeHtml(fileName)}" title="Download file">${getIconSvg("download")} <span>Download</span></a>
        ${!isBackupFile ? `<button class="btn-icon btn-share-file" title="Public link">${getIconSvg("link")} <span>Share</span></button>` : ''}
        ${isBackupFile ? `<button class="btn-primary btn-restore-file" title="Restore this file to workspace">${getIconSvg("rotate-ccw")} <span>Restore</span></button>` : ''}
        ${!isBackupFile ? `<button class="btn-icon btn-rename-file" title="Rename file">${getIconSvg("edit")} <span>Rename</span></button>` : ''}
        <button class="btn-icon btn-delete-file" title="Delete file">${getIconSvg("trash")} <span>Delete</span></button>
        ${!isBackupFile ? `<button class="btn-primary btn-save" title="Save file (Ctrl+S)" style="${(previewType === 'office' || previewType === 'pdf') ? 'display: none;' : ''}">${getIconSvg("save")} <span>Save</span></button>` : ''}
      </div>
    </div>
    <div class="viewer-body">
      <div class="loading-state">Loading file...</div>
    </div>
  `;

  return paneElem;
}

/**
 * Dynamically inserts or removes the Execute button depending on whether file is executable.
 */
export function updateViewerHeaderActions(tabInfo, { onSave } = {}) {
  if (!tabInfo || !tabInfo.paneElement) return;
  const actionsContainer = tabInfo.paneElement.querySelector(".viewer-header-actions");
  if (!actionsContainer) return;
  let btnExec = actionsContainer.querySelector(".btn-execute-file");
  const isExec = isExecutableFile(tabInfo.name);

  if (isExec) {
    if (!btnExec) {
      btnExec = document.createElement("button");
      btnExec.className = "btn-icon btn-execute-file";
      btnExec.title = "Execute in Agent TTY";
      btnExec.innerHTML = `${getIconSvg("zap")} <span>Execute</span>`;
      btnExec.addEventListener("click", async () => {
        if (tabInfo.isDirty && onSave) {
          await onSave(tabInfo);
        }
        executeFileInTty(tabInfo.name);
      });
      const btnShare = actionsContainer.querySelector(".btn-share-file");
      if (btnShare) {
        actionsContainer.insertBefore(btnExec, btnShare);
      } else {
        actionsContainer.appendChild(btnExec);
      }
    }
  } else {
    if (btnExec) {
      btnExec.remove();
    }
  }
}

/**
 * Binds event listeners to action buttons inside the viewer header.
 */
export function bindViewerHeaderActions(tabInfo, { onSave, onModeChange }) {
  const paneElem = tabInfo.paneElement;
  if (!paneElem) return;

  // Save button
  if (tabInfo.saveBtn) {
    tabInfo.saveBtn.addEventListener("click", () => {
      if (onSave) onSave(tabInfo);
    });
  }

  // Execute button
  const btnExecute = paneElem.querySelector(".btn-execute-file");
  if (btnExecute) {
    btnExecute.addEventListener("click", async () => {
      if (tabInfo.isDirty && onSave) {
        await onSave(tabInfo);
      }
      executeFileInTty(tabInfo.name);
    });
  }

  // Share button
  const btnShare = paneElem.querySelector(".btn-share-file");
  if (btnShare) {
    btnShare.addEventListener("click", () => {
      openShareLinkModal(tabInfo.workspace, tabInfo.path, tabInfo.name);
    });
  }

  // Restore button
  const btnRestore = paneElem.querySelector(".btn-restore-file");
  if (btnRestore) {
    btnRestore.addEventListener("click", async () => {
      await doRestoreBackup({ path: tabInfo.path, name: tabInfo.name, is_dir: false });
    });
  }

  // Rename button
  const btnRename = paneElem.querySelector(".btn-rename-file");
  if (btnRename) {
    btnRename.addEventListener("click", async () => {
      const newName = prompt("Enter new file name:", tabInfo.name);
      if (newName && newName.trim() && newName.trim() !== tabInfo.name) {
        await doRenameFile({ path: tabInfo.path, name: tabInfo.name, is_dir: false }, newName.trim());
      }
    });
  }

  // Delete button
  const btnDelete = paneElem.querySelector(".btn-delete-file");
  if (btnDelete) {
    btnDelete.addEventListener("click", async () => {
      await doDeleteFile({ path: tabInfo.path, name: tabInfo.name, is_dir: false });
    });
  }

  // Expand / Fullscreen button
  const btnExpand = paneElem.querySelector(".btn-expand-iframe");
  if (btnExpand) {
    btnExpand.addEventListener("click", () => {
      toggleFullscreenPreview(tabInfo);
    });
  }

  // Mode toggle buttons
  const modeBtns = paneElem.querySelectorAll(".mode-toggle .btn-mode");
  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (onModeChange) onModeChange(tabInfo, mode);
    });
  });
}
