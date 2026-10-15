// Workspace ZIP Download & Upload Modal

import { state } from "./state.js";
import { dom } from "./dom.js";
import { getIconSvg, escapeHtml } from "./icons.js";
import { loadWorkspaces, selectWorkspace } from "./workspace.js";

export function formatZipFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export async function downloadWorkspaceZip(workspaceName) {
  if (!workspaceName) {
    alert("Select a workspace to download.");
    return;
  }
  const btn = dom.btnDownloadWs;
  const origText = btn ? btn.innerHTML : `${getIconSvg("download")}<span>ZIP</span>`;
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${getIconSvg("loader")}<span>ZIP</span>`;
      btn.title = "Creating archive...";
    }
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceName)}/download`);
    if (!res.ok) {
      let errorMsg = "Error downloading archive";
      try {
        const data = await res.json();
        errorMsg = data.detail || errorMsg;
      } catch (_) {}
      alert(errorMsg);
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workspaceName}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  } catch (err) {
    alert("Download error: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = !state.currentWorkspace;
      btn.innerHTML = origText;
      btn.title = "Download workspace (.zip)";
    }
  }
}

export function openUploadModal(initialFile = null) {
  if (!dom.uploadZipModal) return;
  state.selectedZipFile = null;
  if (dom.zipFileInput) dom.zipFileInput.value = "";
  if (dom.uploadStatusMsg) {
    dom.uploadStatusMsg.style.display = "none";
    dom.uploadStatusMsg.className = "modal-status-msg";
    dom.uploadStatusMsg.textContent = "";
  }
  if (dom.dropzoneFilename) {
    dom.dropzoneFilename.style.display = "none";
    dom.dropzoneFilename.textContent = "";
  }
  if (dom.dropzoneLabel) {
    dom.dropzoneLabel.textContent = "Click or drop .zip file here";
  }
  if (dom.btnSubmitUpload) {
    dom.btnSubmitUpload.disabled = true;
    dom.btnSubmitUpload.textContent = "Upload and Extract";
  }
  if (dom.btnCancelUpload) {
    dom.btnCancelUpload.disabled = false;
  }
  if (dom.uploadWsNameInput) {
    dom.uploadWsNameInput.value = "";
  }

  if (state.currentWorkspace) {
    if (dom.labelWsCurrent) {
      dom.labelWsCurrent.style.display = "flex";
    }
    if (dom.uploadWsCurrentText) {
      dom.uploadWsCurrentText.textContent = `To current workspace ("${state.currentWorkspace}")`;
    }
    if (dom.radioWsNew) {
      dom.radioWsNew.checked = true;
    }
  } else {
    if (dom.labelWsCurrent) {
      dom.labelWsCurrent.style.display = "none";
    }
    if (dom.radioWsNew) {
      dom.radioWsNew.checked = true;
    }
  }

  dom.uploadZipModal.style.display = "flex";

  if (initialFile) {
    setUploadZipFile(initialFile);
  }
}

export function closeUploadModal() {
  if (!dom.uploadZipModal) return;
  dom.uploadZipModal.style.display = "none";
  state.selectedZipFile = null;
  if (dom.zipFileInput) dom.zipFileInput.value = "";
}

export function setUploadZipFile(file) {
  if (!file) return;
  const isZip = file.name.toLowerCase().endsWith(".zip") ||
                file.type === "application/zip" ||
                file.type === "application/x-zip-compressed";
  if (!isZip) {
    if (dom.uploadStatusMsg) {
      dom.uploadStatusMsg.style.display = "block";
      dom.uploadStatusMsg.className = "modal-status-msg error";
      dom.uploadStatusMsg.textContent = "Please select a file with .zip extension";
    }
    return;
  }

  state.selectedZipFile = file;

  if (dom.uploadStatusMsg) {
    dom.uploadStatusMsg.style.display = "none";
  }
  if (dom.dropzoneFilename) {
    dom.dropzoneFilename.innerHTML = `${getIconSvg("package")} <span>${escapeHtml(file.name)} (${formatZipFileSize(file.size)})</span>`;
    dom.dropzoneFilename.style.display = "block";
  }
  if (dom.dropzoneLabel) {
    dom.dropzoneLabel.textContent = "File selected:";
  }

  // Auto-fill workspace name from filename if input is empty or if new workspace radio is checked
  const cleanStem = file.name.replace(/\.zip$/i, "").replace(/[/\\?%*:|"<>]+/g, "_").trim();
  if (dom.uploadWsNameInput && (!dom.uploadWsNameInput.value || (dom.radioWsNew && dom.radioWsNew.checked))) {
    dom.uploadWsNameInput.value = cleanStem;
  }

  if (dom.btnSubmitUpload) {
    dom.btnSubmitUpload.disabled = false;
  }
}

export async function uploadWorkspaceZip() {
  if (!state.selectedZipFile) {
    alert("Please select a .zip file.");
    return;
  }

  let targetWs = "";
  if (dom.radioWsCurrent && dom.radioWsCurrent.checked && state.currentWorkspace) {
    targetWs = state.currentWorkspace;
  } else if (dom.uploadWsNameInput) {
    targetWs = dom.uploadWsNameInput.value.trim();
  }

  if (!targetWs) {
    if (dom.uploadStatusMsg) {
      dom.uploadStatusMsg.style.display = "block";
      dom.uploadStatusMsg.className = "modal-status-msg error";
      dom.uploadStatusMsg.textContent = "Please enter a workspace name.";
    }
    return;
  }

  if (targetWs.includes("/") || targetWs.includes("\\") || targetWs.includes("..")) {
    if (dom.uploadStatusMsg) {
      dom.uploadStatusMsg.style.display = "block";
      dom.uploadStatusMsg.className = "modal-status-msg error";
      dom.uploadStatusMsg.textContent = "Invalid workspace name.";
    }
    return;
  }

  const overwrite = dom.uploadOverwriteCheck ? dom.uploadOverwriteCheck.checked : true;

  if (dom.btnSubmitUpload) {
    dom.btnSubmitUpload.disabled = true;
    dom.btnSubmitUpload.textContent = "Uploading and extracting...";
  }
  if (dom.btnCancelUpload) {
    dom.btnCancelUpload.disabled = true;
  }
  if (dom.uploadStatusMsg) {
    dom.uploadStatusMsg.style.display = "block";
    dom.uploadStatusMsg.className = "modal-status-msg";
    dom.uploadStatusMsg.textContent = "Uploading and extracting archive on server...";
  }

  try {
    const formData = new FormData();
    formData.append("file", state.selectedZipFile);
    formData.append("workspace", targetWs);
    formData.append("overwrite", overwrite ? "true" : "false");

    const res = await fetch("/api/workspaces/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Failed to upload and extract archive");
    }

    closeUploadModal();

    // Reload workspaces and switch to the target workspace
    await loadWorkspaces(data.workspace);
    selectWorkspace(data.workspace, true, "push");
  } catch (err) {
    if (dom.uploadStatusMsg) {
      dom.uploadStatusMsg.style.display = "block";
      dom.uploadStatusMsg.className = "modal-status-msg error";
      dom.uploadStatusMsg.textContent = "Error: " + err.message;
    }
    if (dom.btnSubmitUpload) {
      dom.btnSubmitUpload.disabled = false;
      dom.btnSubmitUpload.textContent = "Retry";
    }
    if (dom.btnCancelUpload) {
      dom.btnCancelUpload.disabled = false;
    }
  }
}

export function initWorkspaceZipModal() {
  if (dom.btnDownloadWs) {
    dom.btnDownloadWs.onclick = () => {
      if (state.currentWorkspace) {
        downloadWorkspaceZip(state.currentWorkspace);
      }
    };
  }

  if (dom.btnUploadWs) {
    dom.btnUploadWs.onclick = () => openUploadModal();
  }

  if (dom.btnCloseUploadModal) {
    dom.btnCloseUploadModal.onclick = closeUploadModal;
  }

  if (dom.btnCancelUpload) {
    dom.btnCancelUpload.onclick = closeUploadModal;
  }

  if (dom.btnSubmitUpload) {
    dom.btnSubmitUpload.onclick = uploadWorkspaceZip;
  }

  if (dom.modalDropzone) {
    dom.modalDropzone.onclick = () => {
      if (dom.zipFileInput) dom.zipFileInput.click();
    };

    dom.modalDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dom.modalDropzone.classList.add("dragover");
    });

    dom.modalDropzone.addEventListener("dragleave", () => {
      dom.modalDropzone.classList.remove("dragover");
    });

    dom.modalDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dom.modalDropzone.classList.remove("dragover");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        setUploadZipFile(e.dataTransfer.files[0]);
      }
    });
  }

  if (dom.zipFileInput) {
    dom.zipFileInput.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        setUploadZipFile(e.target.files[0]);
      }
    };
  }

  if (dom.uploadWsNameInput) {
    dom.uploadWsNameInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (dom.btnSubmitUpload && !dom.btnSubmitUpload.disabled) {
          uploadWorkspaceZip();
        }
      }
    };
  }

  // Close upload modal on click outside content or Escape
  window.addEventListener("click", (e) => {
    if (dom.uploadZipModal && dom.uploadZipModal.style.display !== "none" && e.target === dom.uploadZipModal) {
      closeUploadModal();
    }
  });
}
