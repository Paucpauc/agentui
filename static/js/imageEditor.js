// Image Editor module (powered by TOAST UI Image Editor with lightweight canvas fallback)

import { setTabDirty, saveFile } from "./tabs.js";
import { getIconSvg, escapeHtml } from "./icons.js";

/**
 * Custom dark theme configuration for TUI Image Editor
 * Harmonized with Agent Web UI color palette (#181a1f, #21252b, #282c34, #61afef)
 */
export function getTuiDarkTheme() {
  const iconPrefix = "/static/svg/";
  return {
    "common.bi.image": "",
    "common.bisize.width": "0px",
    "common.bisize.height": "0px",
    "common.backgroundImage": "none",
    "common.backgroundColor": "#181a1f",
    "common.border": "0px",

    // header
    "header.backgroundImage": "none",
    "header.backgroundColor": "#21252b",
    "header.border": "0px",

    // load button (hide or style)
    "loadButton.backgroundColor": "#282c34",
    "loadButton.border": "1px solid #3e4451",
    "loadButton.color": "#abb2bf",
    "loadButton.fontFamily": "inherit",
    "loadButton.fontSize": "12px",

    // download/save button
    "downloadButton.backgroundColor": "#61afef",
    "downloadButton.border": "1px solid #61afef",
    "downloadButton.color": "#1e2227",
    "downloadButton.fontFamily": "inherit",
    "downloadButton.fontSize": "12px",

    // main icons
    "menu.normalIcon.path": iconPrefix + "icon-d.svg",
    "menu.normalIcon.name": "icon-d",
    "menu.activeIcon.path": iconPrefix + "icon-b.svg",
    "menu.activeIcon.name": "icon-b",
    "menu.disabledIcon.path": iconPrefix + "icon-a.svg",
    "menu.disabledIcon.name": "icon-a",
    "menu.hoverIcon.path": iconPrefix + "icon-c.svg",
    "menu.hoverIcon.name": "icon-c",
    "menu.iconSize.width": "24px",
    "menu.iconSize.height": "24px",

    // submenu icons
    "submenu.normalIcon.path": iconPrefix + "icon-d.svg",
    "submenu.normalIcon.name": "icon-d",
    "submenu.activeIcon.path": iconPrefix + "icon-c.svg",
    "submenu.activeIcon.name": "icon-c",
    "submenu.iconSize.width": "32px",
    "submenu.iconSize.height": "32px",

    // submenu primary color
    "submenu.backgroundColor": "#21252b",
    "submenu.partition.color": "#3e4451",

    // submenu labels
    "submenu.normalLabel.color": "#858b98",
    "submenu.normalLabel.fontWeight": "normal",
    "submenu.activeLabel.color": "#61afef",
    "submenu.activeLabel.fontWeight": "normal",

    // checkbox style
    "checkbox.border": "1px solid #3e4451",
    "checkbox.backgroundColor": "#282c34",

    // range style
    "range.pointer.color": "#61afef",
    "range.bar.color": "#3e4451",
    "range.subbar.color": "#61afef",

    "range.disabledPointer.color": "#282c34",
    "range.disabledBar.color": "#1e2227",
    "range.disabledSubbar.color": "#282c34",

    "range.value.color": "#abb2bf",
    "range.value.fontWeight": "normal",
    "range.value.fontSize": "11px",
    "range.value.border": "1px solid #3e4451",
    "range.value.backgroundColor": "#181a1f",
    "range.title.color": "#abb2bf",
    "range.title.fontWeight": "normal",

    // colorpicker style
    "colorpicker.button.border": "1px solid #3e4451",
    "colorpicker.title.color": "#abb2bf"
  };
}

/**
 * Initializes image editor inside container for tabInfo
 */
export async function setupImageEditor(tabInfo, container) {
  if (!container || tabInfo.imageEditor) return;

  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "image-editor-root-container";
  wrapper.style.width = "100%";
  wrapper.style.height = "100%";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.position = "relative";
  wrapper.style.overflow = "hidden";
  container.appendChild(wrapper);

  const imageSrc = tabInfo.currentContent || "";
  if (!imageSrc) {
    wrapper.innerHTML = `<div class="editor-loading">${getIconSvg("loader")} <span>Loading image data...</span></div>`;
    return;
  }

  // Check if TUI Image Editor is available on window
  if (typeof window.tui !== "undefined" && window.tui.ImageEditor) {
    initTuiEditor(tabInfo, wrapper, imageSrc);
  } else {
    // Wait briefly in case script is still finishing execution, or fallback
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (typeof window.tui !== "undefined" && window.tui.ImageEditor) {
        clearInterval(interval);
        initTuiEditor(tabInfo, wrapper, imageSrc);
      } else if (attempts >= 15) {
        clearInterval(interval);
        initFallbackCanvasEditor(tabInfo, wrapper, imageSrc);
      }
    }, 100);
  }
}

/**
 * Setup using standard TOAST UI Image Editor
 */
function initTuiEditor(tabInfo, wrapper, imageSrc) {
  wrapper.innerHTML = "";
  const editorEl = document.createElement("div");
  editorEl.className = "tui-image-editor-instance";
  editorEl.style.width = "100%";
  editorEl.style.height = "100%";
  wrapper.appendChild(editorEl);

  try {
    const instance = new window.tui.ImageEditor(editorEl, {
      includeUI: {
        loadImage: {
          path: imageSrc,
          name: tabInfo.name
        },
        theme: getTuiDarkTheme(),
        menu: ["crop", "flip", "rotate", "draw", "shape", "icon", "text", "mask", "filter"],
        initMenu: "",
        uiSize: {
          width: "100%",
          height: "100%"
        },
        menuBarPosition: "bottom"
      },
      cssMaxWidth: 1600,
      cssMaxHeight: 1200,
      selectionStyle: {
        cornerSize: 20,
        rotatingPointOffset: 70
      }
    });

    // Mark tab dirty when user makes edits
    const onAction = () => {
      setTabDirty(tabInfo, true);
    };

    instance.on("objectActivated", onAction);
    instance.on("objectAdded", onAction);
    instance.on("objectModified", onAction);
    instance.on("redoStackChanged", onAction);
    instance.on("undoStackChanged", (len) => {
      if (len > 0) setTabDirty(tabInfo, true);
    });

    // Customize TUI header: replace default download click with our saveFile
    setTimeout(() => {
      const downloadBtn = editorEl.querySelector(".tui-image-editor-download-btn");
      if (downloadBtn) {
        downloadBtn.textContent = "Save";
        downloadBtn.title = "Save file (Ctrl+S)";
        // Replace click handler
        downloadBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          saveFile(tabInfo);
        };
      }
      // Hide standard logo link
      const logo = editorEl.querySelector(".tui-image-editor-header-logo");
      if (logo) {
        logo.style.display = "none";
      }
      // Hide external load button (users open files via file tree)
      const loadBtn = editorEl.querySelector(".tui-image-editor-load-btn");
      if (loadBtn) {
        loadBtn.style.display = "none";
      }
    }, 300);

    tabInfo.imageEditor = {
      type: "tui",
      instance: instance,
      getDataUrl: () => {
        try {
          return instance.toDataURL();
        } catch (e) {
          console.warn("Error getting dataURL from TUI editor:", e);
          return tabInfo.currentContent || "";
        }
      },
      reload: (newSrc) => {
        try {
          instance.loadImageFromURL(newSrc, tabInfo.name);
        } catch (e) {}
      },
      destroy: () => {
        try {
          instance.destroy();
        } catch (e) {}
      }
    };
  } catch (err) {
    console.error("Failed to initialize TUI Image Editor:", err);
    initFallbackCanvasEditor(tabInfo, wrapper, imageSrc);
  }
}

/**
 * Built-in Canvas fallback image editor (ensures editing works in all environments)
 */
function initFallbackCanvasEditor(tabInfo, wrapper, imageSrc) {
  wrapper.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "fallback-editor-toolbar";
  toolbar.innerHTML = `
    <div class="fb-group">
      <button type="button" class="btn-fb-tool" data-action="rotate-left" title="Rotate 90° Left">⤹ 90°</button>
      <button type="button" class="btn-fb-tool" data-action="rotate-right" title="Rotate 90° Right">⤵ 90°</button>
      <button type="button" class="btn-fb-tool" data-action="flip-h" title="Flip Horizontal">⇄ Flip H</button>
      <button type="button" class="btn-fb-tool" data-action="flip-v" title="Flip Vertical">⇅ Flip V</button>
    </div>
    <div class="fb-separator"></div>
    <div class="fb-group">
      <button type="button" class="btn-fb-tool" data-action="grayscale" title="Grayscale Filter">B&W</button>
      <button type="button" class="btn-fb-tool" data-action="invert" title="Invert Colors">Invert</button>
      <button type="button" class="btn-fb-tool" data-action="sepia" title="Sepia Filter">Sepia</button>
      <button type="button" class="btn-fb-tool" data-action="brightness" title="Brightness +15%">Sun +</button>
    </div>
    <div class="fb-separator"></div>
    <div class="fb-group">
      <label class="fb-label">Pen:</label>
      <input type="color" class="fb-color-picker" value="#ff3366" title="Pen Color">
      <input type="range" class="fb-size-picker" min="1" max="50" value="4" title="Pen Size">
    </div>
    <div class="fb-separator"></div>
    <div class="fb-group">
      <button type="button" class="btn-fb-tool btn-fb-reset" data-action="reset" title="Reset changes">Reset</button>
    </div>
  `;
  wrapper.appendChild(toolbar);

  const canvasArea = document.createElement("div");
  canvasArea.className = "fallback-editor-canvas-area checkerboard-bg";
  wrapper.appendChild(canvasArea);

  const canvas = document.createElement("canvas");
  canvas.className = "fallback-editor-canvas";
  canvasArea.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let origImg = new Image();
  origImg.crossOrigin = "anonymous";
  origImg.onload = () => {
    canvas.width = origImg.naturalWidth;
    canvas.height = origImg.naturalHeight;
    ctx.drawImage(origImg, 0, 0);
  };
  origImg.src = imageSrc;

  // Drawing state
  let isDrawing = false;
  let lastX = 0, lastY = 0;

  const colorInput = toolbar.querySelector(".fb-color-picker");
  const sizeInput = toolbar.querySelector(".fb-size-picker");

  canvas.addEventListener("mousedown", (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    lastX = (e.clientX - rect.left) * scaleX;
    lastY = (e.clientY - rect.top) * scaleY;
  });

  window.addEventListener("mouseup", () => {
    if (isDrawing) {
      isDrawing = false;
      setTabDirty(tabInfo, true);
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const curX = (e.clientX - rect.left) * scaleX;
    const curY = (e.clientY - rect.top) * scaleY;

    ctx.strokeStyle = colorInput ? colorInput.value : "#ff3366";
    ctx.lineWidth = sizeInput ? parseInt(sizeInput.value, 10) : 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(curX, curY);
    ctx.stroke();

    lastX = curX;
    lastY = curY;
  });

  // Toolbar actions
  toolbar.querySelectorAll(".btn-fb-tool").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.action;
      if (act === "rotate-right" || act === "rotate-left") {
        const rad = act === "rotate-right" ? Math.PI / 2 : -Math.PI / 2;
        const temp = document.createElement("canvas");
        temp.width = canvas.height;
        temp.height = canvas.width;
        const tCtx = temp.getContext("2d");
        tCtx.translate(temp.width / 2, temp.height / 2);
        tCtx.rotate(rad);
        tCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

        canvas.width = temp.width;
        canvas.height = temp.height;
        ctx.drawImage(temp, 0, 0);
        setTabDirty(tabInfo, true);
      } else if (act === "flip-h") {
        const temp = document.createElement("canvas");
        temp.width = canvas.width;
        temp.height = canvas.height;
        const tCtx = temp.getContext("2d");
        tCtx.translate(canvas.width, 0);
        tCtx.scale(-1, 1);
        tCtx.drawImage(canvas, 0, 0);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(temp, 0, 0);
        setTabDirty(tabInfo, true);
      } else if (act === "flip-v") {
        const temp = document.createElement("canvas");
        temp.width = canvas.width;
        temp.height = canvas.height;
        const tCtx = temp.getContext("2d");
        tCtx.translate(0, canvas.height);
        tCtx.scale(1, -1);
        tCtx.drawImage(canvas, 0, 0);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(temp, 0, 0);
        setTabDirty(tabInfo, true);
      } else if (act === "grayscale") {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        setTabDirty(tabInfo, true);
      } else if (act === "invert") {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = 255 - d[i];
          d[i + 1] = 255 - d[i + 1];
          d[i + 2] = 255 - d[i + 2];
        }
        ctx.putImageData(imgData, 0, 0);
        setTabDirty(tabInfo, true);
      } else if (act === "sepia") {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          d[i] = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
          d[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
          d[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
        }
        ctx.putImageData(imgData, 0, 0);
        setTabDirty(tabInfo, true);
      } else if (act === "brightness") {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = Math.min(255, d[i] + 25);
          d[i + 1] = Math.min(255, d[i + 1] + 25);
          d[i + 2] = Math.min(255, d[i + 2] + 25);
        }
        ctx.putImageData(imgData, 0, 0);
        setTabDirty(tabInfo, true);
      } else if (act === "reset") {
        canvas.width = origImg.naturalWidth;
        canvas.height = origImg.naturalHeight;
        ctx.drawImage(origImg, 0, 0);
        setTabDirty(tabInfo, false);
      }
    });
  });

  tabInfo.imageEditor = {
    type: "fallback",
    canvas: canvas,
    getDataUrl: () => {
      const ext = (tabInfo.name || "").split(".").pop().toLowerCase();
      let mime = "image/png";
      if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
      else if (ext === "webp") mime = "image/webp";
      return canvas.toDataURL(mime, 0.92);
    },
    reload: (newSrc) => {
      origImg = new Image();
      origImg.crossOrigin = "anonymous";
      origImg.onload = () => {
        canvas.width = origImg.naturalWidth;
        canvas.height = origImg.naturalHeight;
        ctx.drawImage(origImg, 0, 0);
      };
      origImg.src = newSrc;
    },
    destroy: () => {}
  };
}
