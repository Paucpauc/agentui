// Workspace Files Multi-Upload Modal and Drag-and-Drop

import { state } from "./state.js";
import { dom } from "./dom.js";
import { getIconSvg, escapeHtml } from "./icons.js";
import { loadFiles } from "./fileTree.js";
import { openFile } from "./tabs.js";

export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function openUploadFilesModal(options = {}, initialFiles = null) {
  if (!dom.uploadFilesModal) return;
  if (!state.currentWorkspace) {
    alert("Please select a workspace first.");
    return;
  }

  const targetDir = (options && options.targetDir) ? options.targetDir : "";
  if (dom.uploadFilesWsBadge) {
    dom.uploadFilesWsBadge.textContent = state.currentWorkspace;
  }
  if (dom.uploadFilesDestDir) {
    dom.uploadFilesDestDir.value = targetDir;
  }
  if (dom.uploadFilesStatusMsg) {
    dom.uploadFilesStatusMsg.style.display = "none";
    dom.uploadFilesStatusMsg.className = "modal-status-msg";
    dom.uploadFilesStatusMsg.textContent = "";
  }
  if (dom.btnCancelUploadFiles) {
    dom.btnCancelUploadFiles.disabled = false;
  }

  state.selectedUploadFiles = [];
  if (dom.fileUploadInput) {
    dom.fileUploadInput.value = "";
  }

  if (initialFiles && initialFiles.length > 0) {
    addFilesToUpload(initialFiles);
  } else {
    renderSelectedUploadFiles();
  }

  dom.uploadFilesModal.style.display = "flex";
}

export function closeUploadFilesModal() {
  if (!dom.uploadFilesModal) return;
  dom.uploadFilesModal.style.display = "none";
  state.selectedUploadFiles = [];
  if (dom.fileUploadInput) {
    dom.fileUploadInput.value = "";
  }
}

export function addFilesToUpload(fileList) {
  if (!fileList || fileList.length === 0) return;
  const filesArray = Array.from(fileList);
  for (const f of filesArray) {
    const exists = state.selectedUploadFiles.some(existing => 
      existing.name === f.name && existing.size === f.size && existing.lastModified === f.lastModified
    );
    if (!exists) {
      state.selectedUploadFiles.push(f);
    }
  }
  renderSelectedUploadFiles();
}

export function removeFileFromUpload(index) {
  if (index >= 0 && index < state.selectedUploadFiles.length) {
    state.selectedUploadFiles.splice(index, 1);
    renderSelectedUploadFiles();
  }
}

export function renderSelectedUploadFiles() {
  if (!dom.filesDropzoneList || !dom.filesDropzoneLabel || !dom.btnSubmitUploadFiles) return;

  if (state.selectedUploadFiles.length === 0) {
    dom.filesDropzoneList.style.display = "none";
    dom.filesDropzoneList.innerHTML = "";
    dom.filesDropzoneLabel.textContent = "Click or drop files here";
    dom.btnSubmitUploadFiles.disabled = true;
    dom.btnSubmitUploadFiles.textContent = "Upload Files";
  } else {
    dom.filesDropzoneList.style.display = "flex";
    dom.filesDropzoneList.innerHTML = "";
    dom.filesDropzoneLabel.textContent = `Selected files: ${state.selectedUploadFiles.length}`;

    state.selectedUploadFiles.forEach((f, idx) => {
      const item = document.createElement("div");
      item.className = "modal-file-list-item";

      const nameSpan = document.createElement("span");
      nameSpan.className = "modal-file-list-name";
      nameSpan.innerHTML = `${getIconSvg("file")} <span>${escapeHtml(f.name)}</span>`;
      nameSpan.title = f.name;

      const metaDiv = document.createElement("div");
      metaDiv.className = "modal-file-list-meta";

      const sizeSpan = document.createElement("span");
      sizeSpan.className = "modal-file-list-size";
      sizeSpan.textContent = formatFileSize(f.size);

      const removeBtn = document.createElement("button");
      removeBtn.className = "modal-file-list-remove";
      removeBtn.innerHTML = getIconSvg("close");
      removeBtn.title = "Remove file from list";
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeFileFromUpload(idx);
      };

      metaDiv.appendChild(sizeSpan);
      metaDiv.appendChild(removeBtn);
      item.appendChild(nameSpan);
      item.appendChild(metaDiv);
      dom.filesDropzoneList.appendChild(item);
    });

    dom.btnSubmitUploadFiles.disabled = false;
    dom.btnSubmitUploadFiles.textContent = `Upload Files (${state.selectedUploadFiles.length})`;
  }
}

export async function submitUploadFiles() {
  if (!state.currentWorkspace || state.selectedUploadFiles.length === 0) return;

  const targetDir = dom.uploadFilesDestDir ? dom.uploadFilesDestDir.value.trim() : "";
  const overwrite = dom.uploadFilesOverwriteCheck ? dom.uploadFilesOverwriteCheck.checked : true;

  if (dom.btnSubmitUploadFiles) {
    dom.btnSubmitUploadFiles.disabled = true;
    dom.btnSubmitUploadFiles.textContent = "Uploading...";
  }
  if (dom.btnCancelUploadFiles) {
    dom.btnCancelUploadFiles.disabled = true;
  }
  if (dom.uploadFilesStatusMsg) {
    dom.uploadFilesStatusMsg.style.display = "block";
    dom.uploadFilesStatusMsg.className = "modal-status-msg";
    dom.uploadFilesStatusMsg.textContent = "Uploading files to server...";
  }

  try {
    const formData = new FormData();
    formData.append("workspace", state.currentWorkspace);
    if (targetDir) {
      formData.append("target_dir", targetDir);
    }
    formData.append("overwrite", overwrite ? "true" : "false");

    for (const f of state.selectedUploadFiles) {
      formData.append("files", f);
    }

    const res = await fetch("/api/files/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Failed to upload files");
    }

    if (dom.uploadFilesStatusMsg) {
      dom.uploadFilesStatusMsg.className = "modal-status-msg success";
      let msg = data.message || `Successfully uploaded ${data.count} file(s)`;
      if (data.skipped && data.skipped.length > 0) {
        msg += ` (skipped: ${data.skipped.length})`;
      }
      dom.uploadFilesStatusMsg.textContent = msg;
    }

    await loadFiles();

    // If 1 file was uploaded, open it if viewable
    if (data.uploaded && data.uploaded.length === 1) {
      const up = data.uploaded[0];
      setTimeout(() => {
        closeUploadFilesModal();
        openFile(up.path, up.name);
      }, 500);
    } else {
      setTimeout(() => {
        closeUploadFilesModal();
      }, 700);
    }
  } catch (err) {
    if (dom.uploadFilesStatusMsg) {
      dom.uploadFilesStatusMsg.style.display = "block";
      dom.uploadFilesStatusMsg.className = "modal-status-msg error";
      dom.uploadFilesStatusMsg.textContent = "Error: " + err.message;
    }
    if (dom.btnSubmitUploadFiles) {
      dom.btnSubmitUploadFiles.disabled = false;
      dom.btnSubmitUploadFiles.textContent = `Retry (${state.selectedUploadFiles.length})`;
    }
    if (dom.btnCancelUploadFiles) {
      dom.btnCancelUploadFiles.disabled = false;
    }
  }
}

export function initFileUploadModal() {
  if (dom.btnUploadFile) {
    dom.btnUploadFile.onclick = () => openUploadFilesModal();
  }

  if (dom.btnCloseUploadFilesModal) {
    dom.btnCloseUploadFilesModal.onclick = closeUploadFilesModal;
  }

  if (dom.btnCancelUploadFiles) {
    dom.btnCancelUploadFiles.onclick = closeUploadFilesModal;
  }

  if (dom.btnSubmitUploadFiles) {
    dom.btnSubmitUploadFiles.onclick = submitUploadFiles;
  }

  if (dom.modalFilesDropzone) {
    dom.modalFilesDropzone.onclick = () => {
      if (dom.fileUploadInput) dom.fileUploadInput.click();
    };

    dom.modalFilesDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dom.modalFilesDropzone.classList.add("dragover");
    });

    dom.modalFilesDropzone.addEventListener("dragleave", () => {
      dom.modalFilesDropzone.classList.remove("dragover");
    });

    dom.modalFilesDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dom.modalFilesDropzone.classList.remove("dragover");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFilesToUpload(e.dataTransfer.files);
      }
    });
  }

  if (dom.fileUploadInput) {
    dom.fileUploadInput.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addFilesToUpload(e.target.files);
      }
    };
  }

  // Close upload files modal on click outside content
  window.addEventListener("click", (e) => {
    if (dom.uploadFilesModal && dom.uploadFilesModal.style.display !== "none" && e.target === dom.uploadFilesModal) {
      closeUploadFilesModal();
    }
  });
}
