// File Preview, Code Runners (HTML, JS, SVG, Markdown), Fullscreen Mode

import { state } from "./state.js";
import { getIconSvg, escapeHtml } from "./icons.js";
import { renderMarkdown } from "./markdown.js";

export const OFFICE_EXTENSIONS = [
  // Word
  "doc", "docx", "docm", "dot", "dotx", "dotm", "rtf", "odt",
  // Excel
  "xls", "xlsx", "xlsm", "xlt", "xltx", "xltm", "xlsb", "ods", "xsl",
  // PowerPoint
  "ppt", "pptx", "pptm", "pot", "potx", "pps", "ppsx", "odp"
];

export function getFilePreviewType(fileName) {
  if (!fileName) return null;
  const ext = fileName.split(".").pop().toLowerCase();
  if (["md", "markdown", "mdown", "mkd"].includes(ext)) {
    return "markdown";
  }
  if (["html", "htm"].includes(ext)) {
    return "html";
  }
  if (ext === "svg") {
    return "svg";
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "tif", "avif"].includes(ext)) {
    return "image";
  }
  if (OFFICE_EXTENSIONS.includes(ext)) {
    return "office";
  }
  if (ext === "pdf") {
    return "pdf";
  }
  return null;
}

export function hasPreview(fileName) {
  return getFilePreviewType(fileName) !== null;
}

export function canRunFile(fileName) {
  if (!fileName) return false;
  const ext = fileName.split(".").pop().toLowerCase();
  return ["html", "htm", "js"].includes(ext);
}

export function getFileTypeLabel(fileName) {
  const pType = getFilePreviewType(fileName);
  if (pType === "markdown") return "Markdown";
  if (pType === "html") return "HTML";
  if (pType === "svg") return "SVG Image";
  if (pType === "pdf") return "PDF Document";
  if (pType === "image") {
    const ext = (fileName || "").split(".").pop().toUpperCase();
    return `${ext} Image`;
  }
  if (pType === "office") {
    const ext = (fileName || "").split(".").pop().toLowerCase();
    if (["doc", "docx", "docm", "dot", "dotx", "odt", "rtf"].includes(ext)) {
      return "Word Document";
    }
    if (["xls", "xlsx", "xlsm", "xlt", "xltx", "xlsb", "ods", "xsl"].includes(ext)) {
      return "Excel Spreadsheet";
    }
    if (["ppt", "pptx", "pptm", "pot", "potx", "pps", "ppsx", "odp"].includes(ext)) {
      return "PowerPoint Presentation";
    }
    return "Office Document";
  }
  const ext = (fileName || "").split(".").pop().toLowerCase();
  if (ext === "py") return "Python";
  if (ext === "js") return "JavaScript";
  if (ext === "json") return "JSON";
  if (ext === "css") return "CSS";
  return "Plain Text";
}

export function isFullscreenPreviewActive() {
  return state.currentFullscreenTab !== null;
}

export function makeFloatingDraggable(btn, container) {
  let isDragging = false;
  let startX = 0, startY = 0;
  let origLeft = 0, origTop = 0;
  let moved = false;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = btn.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;

    btn.classList.add("is-dragging");

    const iframe = container.querySelector("iframe");
    if (iframe) iframe.style.pointerEvents = "none";

    const onPointerMove = (ev) => {
      if (!isDragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        moved = true;
      }
      let newLeft = origLeft + dx;
      let newTop = origTop + dy;
      const padding = 10;
      newLeft = Math.max(padding, Math.min(window.innerWidth - rect.width - padding, newLeft));
      newTop = Math.max(padding, Math.min(window.innerHeight - rect.height - padding, newTop));

      btn.style.left = `${newLeft}px`;
      btn.style.top = `${newTop}px`;
      btn.style.right = "auto";
      btn.style.bottom = "auto";
    };

    const onPointerUp = () => {
      isDragging = false;
      btn.classList.remove("is-dragging");
      const iframe = container.querySelector("iframe");
      if (iframe) iframe.style.pointerEvents = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  btn.addEventListener("pointerdown", onPointerDown);

  btn.addEventListener("click", (e) => {
    if (moved) {
      e.preventDefault();
      e.stopImmediatePropagation();
      moved = false;
    }
  }, true);
}

export function createFloatingExitButton(tabInfo) {
  const floatingBtn = document.createElement("button");
  floatingBtn.className = "floating-exit-fullscreen-btn";
  floatingBtn.type = "button";
  floatingBtn.title = "Exit Fullscreen (Esc)";
  floatingBtn.innerHTML = `
    <span class="floating-exit-icon">${getIconSvg("minimize")}</span>
    <span class="floating-exit-text">Exit Fullscreen</span>
    <span class="floating-exit-hint">(Esc)</span>
  `;

  makeFloatingDraggable(floatingBtn, tabInfo.previewContainer);

  floatingBtn.addEventListener("click", () => {
    exitFullscreenPreview();
  });

  return floatingBtn;
}

export function exitFullscreenPreview() {
  if (!state.currentFullscreenTab) return;
  const tabInfo = state.currentFullscreenTab;
  state.currentFullscreenTab = null;

  if (tabInfo.previewContainer) {
    tabInfo.previewContainer.classList.remove("expanded-full-browser");
    const floatingBtn = tabInfo.previewContainer.querySelector(".floating-exit-fullscreen-btn");
    if (floatingBtn) {
      floatingBtn.remove();
    }
  }

  document.body.classList.remove("body-fullscreen-preview");

  if (tabInfo.paneElement) {
    const btnExpand = tabInfo.paneElement.querySelector(".btn-expand-iframe");
    if (btnExpand) {
      btnExpand.classList.remove("active");
      btnExpand.innerHTML = `${getIconSvg("maximize")} <span>Fullscreen</span>`;
      btnExpand.title = "Expand to full browser";
    }
  }
}

export function enterFullscreenPreview(tabInfo) {
  if (!tabInfo || !tabInfo.previewContainer) return;

  if (state.currentFullscreenTab && state.currentFullscreenTab !== tabInfo) {
    exitFullscreenPreview();
  }

  state.currentFullscreenTab = tabInfo;
  tabInfo.previewContainer.classList.add("expanded-full-browser");
  document.body.classList.add("body-fullscreen-preview");

  // Remove any stale floating button
  const oldBtn = tabInfo.previewContainer.querySelector(".floating-exit-fullscreen-btn");
  if (oldBtn) oldBtn.remove();

  // Create and attach floating exit button
  const floatingBtn = createFloatingExitButton(tabInfo);
  tabInfo.previewContainer.appendChild(floatingBtn);

  if (tabInfo.paneElement) {
    const btnExpand = tabInfo.paneElement.querySelector(".btn-expand-iframe");
    if (btnExpand) {
      btnExpand.classList.add("active");
      btnExpand.innerHTML = `${getIconSvg("minimize")} <span>Minimize</span>`;
      btnExpand.title = "Exit full browser";
    }
  }
}

export function toggleFullscreenPreview(tabInfo) {
  if (state.currentFullscreenTab === tabInfo) {
    exitFullscreenPreview();
  } else {
    enterFullscreenPreview(tabInfo);
  }
}

export function isPublicFilePath(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  const normPath = filePath.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  const segments = normPath.split("/").filter(Boolean);
  return segments.length > 0 && segments[0].toLowerCase() === "public";
}

export function getPublicUrlForFile(workspace, filePath, browserOrigin = "") {
  if (!workspace || !filePath) return null;
  if (!isPublicFilePath(filePath)) {
    return null;
  }
  const normPath = filePath.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  const relPath = normPath.replace(/^public\/?/i, "");
  const wsClean = encodeURIComponent(workspace.trim());
  let url = "";
  if (!relPath || relPath === "index.html") {
    url = `/public/${wsClean}/`;
  } else {
    url = `/public/${wsClean}/${relPath}`;
  }
  if (browserOrigin) {
    const origin = browserOrigin.replace(/\/+$/, "");
    return `${origin}${url}`;
  }
  return url;
}

export function renderHtmlPreview(htmlContent, container, enableScripts = false, publicUrl = null) {
  if (!container) return;
  container.innerHTML = "";

  if (enableScripts) {
    const banner = document.createElement("div");
    banner.className = "run-indicator-banner";
    const subText = publicUrl ? `via ${escapeHtml(publicUrl)}` : "isolated sandbox: parent window access is blocked";
    banner.innerHTML = `
      <div class="run-indicator-left">
        <span class="run-dot"></span> <span><strong>JS Active</strong> (${subText})</span>
      </div>
      <button class="btn-banner-expand" title="Expand to full browser">${getIconSvg("maximize")} <span>Fullscreen</span></button>
    `;
    container.appendChild(banner);

    const bannerExpandBtn = banner.querySelector(".btn-banner-expand");
    if (bannerExpandBtn) {
      bannerExpandBtn.addEventListener("click", () => {
        if (state.activeTabId && state.openTabs.has(state.activeTabId)) {
          toggleFullscreenPreview(state.openTabs.get(state.activeTabId));
        }
      });
    }
  }

  const iframe = document.createElement("iframe");
  iframe.className = "preview-html-frame" + (enableScripts ? " running" : "");

  // Sandbox security:
  // enableScripts=false: Safe preview, scripts blocked.
  // enableScripts=true: JS allowed (allow-scripts), forms allowed (allow-forms), modals allowed (allow-modals).
  // CRITICAL: same-origin permission is strictly OMITTED -> origin is "null", browser blocks ANY access to parent window, DOM, or storage.
  // CRITICAL: allow-top-navigation is strictly OMITTED -> iframe cannot redirect or navigate parent window.
  if (enableScripts) {
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-modals");
  } else {
    iframe.setAttribute("sandbox", "allow-forms");
  }

  iframe.style.width = "100%";
  iframe.style.flex = "1";
  iframe.style.height = "100%";
  iframe.style.border = "none";
  iframe.style.backgroundColor = "#ffffff";
  container.appendChild(iframe);

  if (enableScripts && publicUrl) {
    const sep = publicUrl.includes("?") ? "&" : "?";
    iframe.src = `${publicUrl}${sep}t=${Date.now()}`;
  } else {
    iframe.srcdoc = htmlContent || "";
  }

  if (state.currentFullscreenTab && state.currentFullscreenTab.previewContainer === container) {
    const existing = container.querySelector(".floating-exit-fullscreen-btn");
    if (!existing) {
      const floatingBtn = createFloatingExitButton(state.currentFullscreenTab);
      container.appendChild(floatingBtn);
    }
  }
}

export function renderJsRunner(jsContent, container) {
  if (!container) return;
  container.innerHTML = "";

  const banner = document.createElement("div");
  banner.className = "run-indicator-banner";
  banner.innerHTML = `
    <div class="run-indicator-left">
      <span class="run-dot"></span> <span><strong>JS Console</strong> (isolated sandbox: parent window access is blocked)</span>
    </div>
    <button class="btn-banner-expand" title="Expand to full browser">${getIconSvg("maximize")} <span>Fullscreen</span></button>
  `;
  container.appendChild(banner);

  const bannerExpandBtn = banner.querySelector(".btn-banner-expand");
  if (bannerExpandBtn) {
    bannerExpandBtn.addEventListener("click", () => {
      if (state.activeTabId && state.openTabs.has(state.activeTabId)) {
        toggleFullscreenPreview(state.openTabs.get(state.activeTabId));
      }
    });
  }

  const iframe = document.createElement("iframe");
  iframe.className = "preview-html-frame running";
  iframe.setAttribute("sandbox", "allow-scripts allow-modals");
  iframe.style.width = "100%";
  iframe.style.flex = "1";
  iframe.style.height = "100%";
  iframe.style.border = "none";
  iframe.style.backgroundColor = "#181a1f";
  container.appendChild(iframe);

  const escapedScript = (jsContent || "").replace(/<\/script>/gi, "<\\/script>");
  const runnerHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: "Fira Code", Monaco, Consolas, monospace; background: #181a1f; color: #abb2bf; padding: 16px; margin: 0; font-size: 13px; line-height: 1.6; }
    .log-entry { margin-bottom: 6px; padding: 6px 10px; border-radius: 4px; background: #21252b; word-break: break-all; white-space: pre-wrap; font-size: 12px; }
    .log-error { color: #e06c75; background: rgba(224, 108, 117, 0.15); border-left: 3px solid #e06c75; }
    .log-warn { color: #e5c07b; background: rgba(229, 192, 123, 0.15); border-left: 3px solid #e5c07b; }
    .log-info { color: #61afef; background: rgba(97, 175, 239, 0.15); border-left: 3px solid #61afef; }
    .empty-logs { color: #5c6370; font-style: italic; padding: 8px 0; }
  </style>
</head>
<body>
  <div id="console-logs"><div class="empty-logs">Script executed. No console output.</div></div>
  <script>
    const logsEl = document.getElementById('console-logs');
    let hasLogs = false;
    function appendLog(type, args) {
      if (!hasLogs) { logsEl.innerHTML = ''; hasLogs = true; }
      const entry = document.createElement('div');
      entry.className = 'log-entry ' + (type ? 'log-' + type : '');
      entry.textContent = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
      logsEl.appendChild(entry);
    }
    const origLog = console.log, origWarn = console.warn, origError = console.error, origInfo = console.info;
    console.log = (...args) => { try { origLog(...args); } catch(e){} appendLog('log', args); };
    console.warn = (...args) => { try { origWarn(...args); } catch(e){} appendLog('warn', args); };
    console.error = (...args) => { try { origError(...args); } catch(e){} appendLog('error', args); };
    console.info = (...args) => { try { origInfo(...args); } catch(e){} appendLog('info', args); };
    window.onerror = (msg, url, line) => { appendLog('error', ['Runtime Error: ' + msg + ' (line ' + line + ')']); };
    try {
      ${escapedScript}
    } catch(e) {
      appendLog('error', [e.stack || e.message]);
    }
  <\/script>
</body>
</html>`;

  iframe.srcdoc = runnerHtml;

  if (state.currentFullscreenTab && state.currentFullscreenTab.previewContainer === container) {
    const existing = container.querySelector(".floating-exit-fullscreen-btn");
    if (!existing) {
      const floatingBtn = createFloatingExitButton(state.currentFullscreenTab);
      container.appendChild(floatingBtn);
    }
  }
}

export function renderSvgPreview(svgContent, container, tabInfo = null) {
  if (!container) return;
  const cleanSvg = typeof DOMPurify !== "undefined"
    ? DOMPurify.sanitize(svgContent || "", { USE_PROFILES: { svg: true, svgFilters: true } })
    : (svgContent || "");

  container.innerHTML = `
    <div class="image-preview-wrapper">
      <div class="image-preview-toolbar">
        <div class="image-preview-info">
          <span class="img-format-badge">SVG</span>
          <span class="img-dim-info">Vector Graphic</span>
        </div>
        <div class="image-preview-controls">
          <button type="button" class="btn-img-ctrl btn-img-to-editor" title="Edit SVG Source Code">${getIconSvg("code")} <span>Source</span></button>
        </div>
      </div>
      <div class="image-preview-viewport checkerboard-bg">
        <div class="svg-preview-wrapper">${cleanSvg}</div>
      </div>
    </div>
  `;

  const btnEdit = container.querySelector(".btn-img-to-editor");
  if (btnEdit && tabInfo && tabInfo.paneElement) {
    btnEdit.addEventListener("click", () => {
      const modeBtn = tabInfo.paneElement.querySelector('.mode-toggle .btn-mode[data-mode="edit"]');
      if (modeBtn) modeBtn.click();
    });
  }
}

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function renderImagePreview(imageContent, container, tabInfo = null) {
  if (!container) return;
  container.innerHTML = "";

  const imageSrc = imageContent || (tabInfo ? tabInfo.currentContent : "") || "";
  if (!imageSrc) {
    container.innerHTML = `<div class="preview-empty">No image data to display.</div>`;
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "image-preview-wrapper";

  const toolbar = document.createElement("div");
  toolbar.className = "image-preview-toolbar";

  const infoBadge = document.createElement("div");
  infoBadge.className = "image-preview-info";
  const ext = tabInfo ? (tabInfo.name.split(".").pop() || "").toUpperCase() : "IMG";
  infoBadge.innerHTML = `
    <span class="img-format-badge">${escapeHtml(ext)}</span>
    <span class="img-dim-info">Loading...</span>
  `;

  const controls = document.createElement("div");
  controls.className = "image-preview-controls";
  controls.innerHTML = `
    <button type="button" class="btn-img-ctrl btn-zoom-out" title="Zoom Out (-)">${getIconSvg("minus")}</button>
    <span class="img-zoom-level">100%</span>
    <button type="button" class="btn-img-ctrl btn-zoom-in" title="Zoom In (+)">${getIconSvg("plus")}</button>
    <button type="button" class="btn-img-ctrl btn-zoom-100" title="Actual Size (1:1)">100%</button>
    <button type="button" class="btn-img-ctrl btn-zoom-fit" title="Fit to Window">Fit</button>
    <button type="button" class="btn-img-ctrl btn-img-rotate" title="Rotate Preview 90°">⤵ 90°</button>
    <button type="button" class="btn-img-ctrl btn-img-to-editor" title="Open in Image Editor">${getIconSvg("edit")} <span>Editor</span></button>
  `;

  toolbar.appendChild(infoBadge);
  toolbar.appendChild(controls);
  wrapper.appendChild(toolbar);

  const viewport = document.createElement("div");
  viewport.className = "image-preview-viewport checkerboard-bg";

  const stage = document.createElement("div");
  stage.className = "image-preview-stage";

  const img = document.createElement("img");
  img.className = "image-preview-img";
  img.alt = tabInfo ? tabInfo.name : "Image";
  img.src = imageSrc;

  stage.appendChild(img);
  viewport.appendChild(stage);
  wrapper.appendChild(viewport);
  container.appendChild(wrapper);

  // Zoom / Pan / Rotation state
  let zoom = 1;
  let rotation = 0;
  let panX = 0, panY = 0;
  const zoomLevelEl = controls.querySelector(".img-zoom-level");

  function updateTransform() {
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom}) rotate(${rotation}deg)`;
    if (zoomLevelEl) {
      zoomLevelEl.textContent = `${Math.round(zoom * 100)}%`;
    }
  }

  function fitToWindow() {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const pad = 48;
    const vW = Math.max(100, viewport.clientWidth - pad);
    const vH = Math.max(100, viewport.clientHeight - pad);
    const scaleX = vW / img.naturalWidth;
    const scaleY = vH / img.naturalHeight;
    zoom = Math.min(1, scaleX, scaleY);
    panX = 0;
    panY = 0;
    updateTransform();
  }

  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const sz = tabInfo && tabInfo.lastKnownSize ? formatFileSize(tabInfo.lastKnownSize) : "";
    infoBadge.innerHTML = `
      <span class="img-format-badge">${escapeHtml(ext)}</span>
      <span class="img-dim-info">${w} × ${h} px</span>
      ${sz ? `<span class="img-size-info">${escapeHtml(sz)}</span>` : ""}
    `;
    fitToWindow();
  };

  // Zoom controls
  const btnZoomIn = controls.querySelector(".btn-zoom-in");
  const btnZoomOut = controls.querySelector(".btn-zoom-out");
  const btnZoom100 = controls.querySelector(".btn-zoom-100");
  const btnZoomFit = controls.querySelector(".btn-zoom-fit");
  const btnRotate = controls.querySelector(".btn-img-rotate");
  const btnToEditor = controls.querySelector(".btn-img-to-editor");

  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => {
      zoom = Math.min(10, zoom * 1.25);
      updateTransform();
    });
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      zoom = Math.max(0.05, zoom / 1.25);
      updateTransform();
    });
  }
  if (btnZoom100) {
    btnZoom100.addEventListener("click", () => {
      zoom = 1;
      panX = 0;
      panY = 0;
      updateTransform();
    });
  }
  if (btnZoomFit) {
    btnZoomFit.addEventListener("click", () => {
      fitToWindow();
    });
  }
  if (btnRotate) {
    btnRotate.addEventListener("click", () => {
      rotation = (rotation + 90) % 360;
      updateTransform();
    });
  }
  if (btnToEditor && tabInfo && tabInfo.paneElement) {
    btnToEditor.addEventListener("click", () => {
      const modeBtn = tabInfo.paneElement.querySelector('.mode-toggle .btn-mode[data-mode="edit"]');
      if (modeBtn) modeBtn.click();
    });
  }

  // Mouse wheel zoom
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    zoom = Math.max(0.05, Math.min(10, zoom * factor));
    updateTransform();
  }, { passive: false });

  // Pan by dragging
  let isPanning = false;
  let startX = 0, startY = 0;

  viewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    viewport.classList.add("is-panning");
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPanning) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    updateTransform();
  });

  window.addEventListener("mouseup", () => {
    if (isPanning) {
      isPanning = false;
      viewport.classList.remove("is-panning");
    }
  });

  // Double click to toggle 100% and Fit
  viewport.addEventListener("dblclick", () => {
    if (Math.abs(zoom - 1) < 0.05) {
      fitToWindow();
    } else {
      zoom = 1;
      panX = 0;
      panY = 0;
      updateTransform();
    }
  });
}

export async function getOfficeShareUrl(workspace, filePath, browserOrigin = "") {
  if (!browserOrigin) {
    const savedBase = localStorage.getItem("office_preview_public_base") || "";
    browserOrigin = savedBase || window.location.origin || `${window.location.protocol}//${window.location.host}`;
  }
  browserOrigin = browserOrigin.replace(/\/+$/, "");

  // If inside public/ directory, direct public URL can be used
  if (isPublicFilePath(filePath)) {
    const directUrl = getPublicUrlForFile(workspace, filePath, browserOrigin);
    if (directUrl) return directUrl;
  }

  // Use the existing temporary signed share link mechanism (/api/files/public-link)
  const res = await fetch("/api/files/public-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace: workspace,
      path: filePath,
      expires_in: 86400 * 7, // 7 days expiration for previewing
      download: false,
      base_url: browserOrigin,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to generate temporary share link");
  }

  const data = await res.json();
  if (data.path_url) {
    return new URL(data.path_url, browserOrigin).href;
  }
  if (data.full_path_url) {
    try {
      const parsed = new URL(data.full_path_url);
      return `${browserOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch (_) {
      return data.full_path_url;
    }
  }
  if (data.url) {
    return new URL(data.url, browserOrigin).href;
  }
  return data.full_url || "";
}

export async function renderOfficePreview(tabInfo, container) {
  if (!container) return;
  container.innerHTML = `
    <div class="office-preview-loading">
      ${getIconSvg("loader")}
      <span>Loading Microsoft 365...</span>
    </div>
  `;

  const savedBase = localStorage.getItem("office_preview_public_base") || "";
  const browserOrigin = (savedBase || window.location.origin || `${window.location.protocol}//${window.location.host}`).replace(/\/+$/, "");
  const ws = tabInfo.workspace || state.currentWorkspace;
  const filePath = tabInfo.path;

  const isLocalHost = Boolean(
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.startsWith("192.168.") ||
    window.location.hostname.startsWith("10.") ||
    window.location.hostname.endsWith(".local")
  );

  let publicDocUrl = "";
  try {
    // Generate temporary share link using existing share mechanism
    publicDocUrl = await getOfficeShareUrl(ws, filePath, browserOrigin);
  } catch (err) {
    container.innerHTML = `
      <div class="office-preview-error">
        <div class="office-error-icon">${getIconSvg("alert-triangle")}</div>
        <div class="office-error-title">Failed to prepare temporary link</div>
        <div class="office-error-msg">${escapeHtml(err.message)}</div>
        <div class="office-error-actions">
          <a class="btn-primary" href="/api/files/raw?workspace=${encodeURIComponent(ws)}&path=${encodeURIComponent(filePath)}" download="${escapeHtml(tabInfo.name)}">
            ${getIconSvg("download")} <span>Download file</span>
          </a>
        </div>
      </div>
    `;
    return;
  }

  // Microsoft 365 embed URL
  const officeEmbedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(publicDocUrl)}`;

  container.innerHTML = "";

  // Localhost warning banner if no custom public base URL is set
  if (isLocalHost && !savedBase) {
    const notice = document.createElement("div");
    notice.className = "office-local-warning";
    notice.innerHTML = `
      <div class="office-warning-content">
        ${getIconSvg("alert-triangle")}
        <div class="office-warning-text">
          <strong>Note:</strong> Microsoft 365 loads files from its cloud servers. The <code>localhost</code> address is not accessible to Microsoft servers from the internet.
          For previewing, provide a public tunnel URL (ngrok, cloudflared) or open the file using the <strong>Download</strong> button above.
        </div>
      </div>
      <div class="office-warning-actions">
        <button type="button" class="btn-warning-set-url">${getIconSvg("globe")} Set URL</button>
        <button type="button" class="btn-warning-dismiss" title="Close">${getIconSvg("close")}</button>
      </div>
    `;
    const btnSetUrl = notice.querySelector(".btn-warning-set-url");
    if (btnSetUrl) {
      btnSetUrl.addEventListener("click", () => {
        const current = localStorage.getItem("office_preview_public_base") || "";
        const input = prompt(
          "Specify a public base URL (e.g. https://xxxx.ngrok-free.app or your domain) so Microsoft 365 servers can fetch the file.\nLeave empty to reset to current browser address:",
          current || window.location.origin
        );
        if (input !== null) {
          const trimmed = input.trim().replace(/\/+$/, "");
          if (trimmed) {
            localStorage.setItem("office_preview_public_base", trimmed);
          } else {
            localStorage.removeItem("office_preview_public_base");
          }
          renderOfficePreview(tabInfo, container);
        }
      });
    }
    const btnDismiss = notice.querySelector(".btn-warning-dismiss");
    if (btnDismiss) {
      btnDismiss.addEventListener("click", () => {
        notice.remove();
      });
    }
    container.appendChild(notice);
  }

  const iframe = document.createElement("iframe");
  iframe.className = "office-preview-frame";
  iframe.src = officeEmbedUrl;
  iframe.setAttribute("allowfullscreen", "true");
  iframe.title = `Microsoft 365: ${tabInfo.name}`;
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.flex = "1";
  iframe.style.border = "none";
  iframe.style.backgroundColor = "#ffffff";

  container.appendChild(iframe);

  if (state.currentFullscreenTab && state.currentFullscreenTab.previewContainer === container) {
    const existing = container.querySelector(".floating-exit-fullscreen-btn");
    if (!existing) {
      const floatingBtn = createFloatingExitButton(state.currentFullscreenTab);
      container.appendChild(floatingBtn);
    }
  }
}

export function renderPdfPreview(tabInfo, container) {
  if (!container) return;
  container.innerHTML = "";

  const ws = tabInfo.workspace || state.currentWorkspace;
  const filePath = tabInfo.path;
  const pdfUrl = `/api/files/raw?workspace=${encodeURIComponent(ws)}&path=${encodeURIComponent(filePath)}&inline=1`;

  const iframe = document.createElement("iframe");
  iframe.className = "pdf-preview-frame";
  iframe.src = pdfUrl;
  iframe.title = `PDF: ${tabInfo.name}`;
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.flex = "1";
  iframe.style.border = "none";
  iframe.style.backgroundColor = "#525659";

  container.appendChild(iframe);

  if (state.currentFullscreenTab && state.currentFullscreenTab.previewContainer === container) {
    const existing = container.querySelector(".floating-exit-fullscreen-btn");
    if (!existing) {
      const floatingBtn = createFloatingExitButton(state.currentFullscreenTab);
      container.appendChild(floatingBtn);
    }
  }
}

export function renderTabPreview(tabInfo, isRun = false) {
  if (!tabInfo || !tabInfo.previewContainer) return;
  const content = tabInfo.editor
    ? tabInfo.editor.getValue()
    : (tabInfo.textarea ? tabInfo.textarea.value : (tabInfo.currentContent || ""));

  if (tabInfo.previewType === "markdown") {
    renderMarkdown(content, tabInfo.previewContainer, tabInfo.path);
  } else if (tabInfo.previewType === "html") {
    const ws = tabInfo.workspace || state.currentWorkspace;
    const isPublic = isPublicFilePath(tabInfo.path);
    const publicUrl = (isRun && isPublic) ? getPublicUrlForFile(ws, tabInfo.path) : null;
    renderHtmlPreview(content, tabInfo.previewContainer, isRun, publicUrl);
  } else if (tabInfo.previewType === "svg") {
    renderSvgPreview(content, tabInfo.previewContainer, tabInfo);
  } else if (tabInfo.previewType === "image") {
    renderImagePreview(content, tabInfo.previewContainer, tabInfo);
  } else if (tabInfo.previewType === "office") {
    renderOfficePreview(tabInfo, tabInfo.previewContainer);
  } else if (tabInfo.previewType === "pdf") {
    renderPdfPreview(tabInfo, tabInfo.previewContainer);
  } else if (canRunFile(tabInfo.name) && isRun) {
    renderJsRunner(content, tabInfo.previewContainer);
  }
}
