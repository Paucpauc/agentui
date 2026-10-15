// Code Editor and Textarea Management (Ace Editor & Fallback)

import { getIconSvg, escapeHtml } from "./icons.js";
import { getFileTypeLabel } from "./preview.js";
import { setupImageEditor } from "./imageEditor.js";

// Configure Ace Editor if available
if (typeof window !== "undefined" && window.ace) {
  try {
    ace.config.set("basePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.36.2/");
  } catch (e) {
    console.warn("Could not set Ace basePath", e);
  }
}

/**
 * Retrieves the current content from whichever editor is active in the tab
 * (image editor data URL, Ace editor text, or textarea value).
 */
export function getEditorContent(tabInfo) {
  if (!tabInfo) return "";
  if (tabInfo.imageEditor && typeof tabInfo.imageEditor.getDataUrl === "function") {
    return tabInfo.imageEditor.getDataUrl();
  }
  if (tabInfo.editor) {
    return tabInfo.editor.getValue();
  }
  if (tabInfo.textarea) {
    return tabInfo.textarea.value;
  }
  return tabInfo.currentContent || "";
}

/**
 * Sets new content into the tab's active code editor or textarea.
 */
export function setEditorContent(tabInfo, content) {
  if (!tabInfo) return;
  tabInfo.currentContent = content;
  if (tabInfo.editor) {
    tabInfo.editor.setValue(content, -1);
  } else if (tabInfo.textarea) {
    tabInfo.textarea.value = content;
  }
}

/**
 * Resizes and focuses the active editor inside a tab.
 */
export function resizeAndFocusEditor(tabInfo, delay = 50) {
  if (!tabInfo) return;
  if (tabInfo.editor && tabInfo.mode === "edit") {
    setTimeout(() => {
      tabInfo.editor.resize();
      tabInfo.editor.focus();
    }, delay);
  } else if (tabInfo.textarea && tabInfo.mode === "edit") {
    setTimeout(() => {
      tabInfo.textarea.focus();
    }, delay);
  }
}

/**
 * Safely tears down and cleans up any Ace editor or image editor instances.
 */
export function destroyEditor(tabInfo) {
  if (!tabInfo) return;
  if (tabInfo.editor) {
    try {
      tabInfo.editor.destroy();
      if (tabInfo.editor.container) {
        tabInfo.editor.container.remove();
      }
    } catch (e) {}
    tabInfo.editor = null;
  }
  if (tabInfo.imageEditor && typeof tabInfo.imageEditor.destroy === "function") {
    try {
      tabInfo.imageEditor.destroy();
    } catch (e) {}
    tabInfo.imageEditor = null;
  }
}

/**
 * Creates the editor DOM container for a tab (Image editor, Binary placeholder,
 * Ace Editor instance, or Fallback <textarea>).
 */
export function createEditorContainer(tabInfo, initialContent, { onDirty, onSave } = {}) {
  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";

  if (tabInfo.previewType === "image") {
    editorContainer.classList.add("image-editor-container-pane");
    if (tabInfo.mode === "edit") {
      setupImageEditor(tabInfo, editorContainer);
    }
  } else if (tabInfo.previewType === "office" || tabInfo.previewType === "pdf") {
    const typeLabel = tabInfo.previewType === "pdf"
      ? "PDF document"
      : `Office document (${escapeHtml(getFileTypeLabel(tabInfo.name))})`;
    editorContainer.innerHTML = `
      <div class="empty-state">
        <p>${typeLabel} is a binary file.</p>
        <p>Use <strong>Preview</strong> mode to view it, or download the file.</p>
        <a class="btn-primary" href="/api/files/raw?workspace=${encodeURIComponent(tabInfo.workspace)}&path=${encodeURIComponent(tabInfo.path)}" download="${escapeHtml(tabInfo.name)}" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none; margin-top: 10px;">
          ${getIconSvg("download")} <span>Download File</span>
        </a>
      </div>
    `;
  } else if (window.ace) {
    const editorDiv = document.createElement("div");
    editorDiv.className = "file-editor ace-editor-instance";
    editorContainer.appendChild(editorDiv);

    const editor = ace.edit(editorDiv);
    editor.setTheme("ace/theme/one_dark");

    let mode = "ace/mode/text";
    if (ace.require) {
      try {
        const modelist = ace.require("ace/ext/modelist");
        if (modelist) {
          const modeInfo = modelist.getModeForPath(tabInfo.name);
          if (modeInfo && modeInfo.mode) {
            mode = modeInfo.mode;
          }
        }
      } catch (e) {}
    }
    editor.session.setMode(mode);
    editor.session.setUseWorker(false);
    editor.session.setTabSize(2);
    editor.session.setUseSoftTabs(true);
    editor.session.setUseWrapMode(true);
    editor.setShowPrintMargin(false);
    editor.setFontSize("13px");
    editor.setValue(initialContent, -1);

    const isReadOnly = Boolean(tabInfo.isTruncated || tabInfo.isReadOnly || (tabInfo.path && tabInfo.path.startsWith(".backup/")));
    if (isReadOnly) {
      editor.setReadOnly(true);
    }

    editor.on("change", () => {
      const val = editor.getValue();
      tabInfo.currentContent = val;
      if (onDirty) {
        onDirty(val !== tabInfo.originalContent);
      }
    });

    editor.commands.addCommand({
      name: "saveFile",
      bindKey: { win: "Ctrl-S", mac: "Command-S" },
      exec: () => {
        if (onSave) onSave();
      }
    });

    tabInfo.editor = editor;
  } else {
    const textarea = document.createElement("textarea");
    textarea.className = "file-editor";
    textarea.spellcheck = false;
    textarea.autocomplete = "off";
    textarea.autocorrect = "off";
    textarea.autocapitalize = "off";
    textarea.value = initialContent;
    const isReadOnly = Boolean(tabInfo.isTruncated || tabInfo.isReadOnly || (tabInfo.path && tabInfo.path.startsWith(".backup/")));
    if (isReadOnly) {
      textarea.readOnly = true;
    }

    editorContainer.appendChild(textarea);
    tabInfo.textarea = textarea;

    textarea.addEventListener("input", () => {
      tabInfo.currentContent = textarea.value;
      const dirty = textarea.value !== tabInfo.originalContent;
      if (onDirty) {
        onDirty(dirty);
      }
    });

    // Indentation with Tab key in fallback textarea
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + "  " + val.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        textarea.dispatchEvent(new Event("input"));
      }
    });
  }

  return editorContainer;
}
