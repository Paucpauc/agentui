// Share File Public Link Modal

import { state } from "./state.js";
import { dom } from "./dom.js";
import { getIconSvg, escapeHtml } from "./icons.js";
import { getPublicUrlForFile } from "./preview.js";

export async function generateAndDisplayShareLink() {
  if (!state.currentShareTarget) return;
  const { workspace, path } = state.currentShareTarget;
  const download = dom.shareDownloadCheck ? dom.shareDownloadCheck.checked : false;

  if (dom.shareCopyStatus) dom.shareCopyStatus.style.display = "none";

  const browserOrigin = window.location.origin || `${window.location.protocol}//${window.location.host}`;

  // For files inside the public folder, use the direct public URL instead of signed HMAC link
  const directPublicUrl = getPublicUrlForFile(workspace, path, browserOrigin);
  if (directPublicUrl) {
    let finalUrl = directPublicUrl;
    if (download) {
      finalUrl += (finalUrl.includes("?") ? "&" : "?") + "download=1";
    }
    if (dom.shareLinkUrlInput) {
      dom.shareLinkUrlInput.value = finalUrl;
    }
    if (dom.shareOpenLink) {
      dom.shareOpenLink.href = finalUrl;
    }
    return;
  }

  const expiresIn = parseInt(dom.shareExpirySelect ? dom.shareExpirySelect.value : "86400", 10) || 86400;
  if (dom.shareLinkUrlInput) dom.shareLinkUrlInput.value = "Generating link...";
  if (dom.shareOpenLink) dom.shareOpenLink.removeAttribute("href");

  try {
    const res = await fetch("/api/files/public-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: workspace,
        path: path,
        expires_in: expiresIn,
        download: download,
        base_url: browserOrigin,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to generate link");
    }

    const data = await res.json();

    // Use protocol and hostname from the browser (e.g. when behind a reverse proxy)
    let publicUrl = "";
    if (data.url) {
      publicUrl = new URL(data.url, browserOrigin).href;
    } else if (data.full_url) {
      try {
        const parsed = new URL(data.full_url);
        publicUrl = `${browserOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
      } catch (_) {
        publicUrl = data.full_url;
      }
    } else {
      publicUrl = data.full_url || "";
    }

    if (dom.shareLinkUrlInput) {
      dom.shareLinkUrlInput.value = publicUrl;
    }
    if (dom.shareOpenLink) {
      dom.shareOpenLink.href = publicUrl;
    }
  } catch (err) {
    if (dom.shareLinkUrlInput) {
      dom.shareLinkUrlInput.value = "Error: " + err.message;
    }
  }
}

export function openShareLinkModal(workspace, filePath, fileName) {
  if (!dom.shareLinkModal) return;
  state.currentShareTarget = { workspace, path: filePath, name: fileName };

  const isPublic = Boolean(getPublicUrlForFile(workspace, filePath));

  if (dom.shareFileNameEl) {
    dom.shareFileNameEl.innerHTML = `${getIconSvg("file")} <span>${escapeHtml(fileName)} <span style="color: var(--text-muted); font-size: 11px;">(${escapeHtml(workspace)}/${escapeHtml(filePath)})</span></span>`;
  }
  if (dom.shareExpirySelect) {
    dom.shareExpirySelect.value = "86400";
    const group = dom.shareExpirySelect.closest(".modal-form-group");
    if (group) group.style.display = isPublic ? "none" : "";
  }
  if (dom.shareDownloadCheck) {
    dom.shareDownloadCheck.checked = false;
  }
  if (dom.shareCopyStatus) {
    dom.shareCopyStatus.style.display = "none";
    dom.shareCopyStatus.textContent = "";
  }
  if (dom.btnCopyShareLink) {
    dom.btnCopyShareLink.innerHTML = `${getIconSvg("copy")} <span>Copy</span>`;
  }

  const infoBox = dom.shareLinkModal.querySelector(".modal-info-box span");
  if (infoBox) {
    if (isPublic) {
      infoBox.textContent = "File is located in the public folder and is accessible via direct link without authentication and without expiration.";
    } else {
      infoBox.textContent = "Link is signed with SHA-256 HMAC, expires over time, and requires no authentication.";
    }
  }

  dom.shareLinkModal.style.display = "flex";
  generateAndDisplayShareLink();
}

export function closeShareLinkModal() {
  if (dom.shareLinkModal) {
    dom.shareLinkModal.style.display = "none";
  }
  state.currentShareTarget = null;
}

export function initShareModal() {
  if (dom.shareExpirySelect) {
    dom.shareExpirySelect.onchange = generateAndDisplayShareLink;
  }

  if (dom.shareDownloadCheck) {
    dom.shareDownloadCheck.onchange = generateAndDisplayShareLink;
  }

  if (dom.shareLinkUrlInput) {
    dom.shareLinkUrlInput.onclick = () => dom.shareLinkUrlInput.select();
  }

  if (dom.btnCloseShareModal) {
    dom.btnCloseShareModal.onclick = closeShareLinkModal;
  }

  if (dom.btnDoneShareModal) {
    dom.btnDoneShareModal.onclick = closeShareLinkModal;
  }

  if (dom.btnCopyShareLink) {
    dom.btnCopyShareLink.onclick = async () => {
      if (!dom.shareLinkUrlInput) return;
      const text = dom.shareLinkUrlInput.value;
      if (!text || text.startsWith("Generating") || text.startsWith("Error")) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          dom.shareLinkUrlInput.select();
          document.execCommand("copy");
        }
        dom.btnCopyShareLink.innerHTML = `${getIconSvg("check")} <span>Copied!</span>`;
        if (dom.shareCopyStatus) {
          dom.shareCopyStatus.className = "modal-status-msg success";
          dom.shareCopyStatus.textContent = "Link copied to clipboard!";
          dom.shareCopyStatus.style.display = "block";
        }
        setTimeout(() => {
          if (dom.btnCopyShareLink) dom.btnCopyShareLink.innerHTML = `${getIconSvg("copy")} <span>Copy</span>`;
        }, 2500);
      } catch (e) {
        dom.shareLinkUrlInput.select();
      }
    };
  }

  if (dom.shareLinkModal) {
    dom.shareLinkModal.onclick = (e) => {
      if (e.target === dom.shareLinkModal) {
        closeShareLinkModal();
      }
    };
  }
}
