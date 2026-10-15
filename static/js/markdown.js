// Markdown Parser, LaTeX, Mermaid & Flowchart.js Diagrams, Link Resolution

import { state } from "./state.js";
import { escapeHtml } from "./icons.js";
import { openFile } from "./tabs.js";
import { selectWorkspace } from "./workspace.js";

export const DOMPURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_TAGS: [
    "semantics", "annotation", "annotation-xml",
    "mpadded", "mphantom", "maligngroup", "malignmark"
  ],
  ADD_ATTR: [
    "aria-hidden", "accent", "fence", "separator", "stretchy", "symmetric",
    "largeop", "movablelimits", "lspace", "rspace", "mathsize", "mathvariant",
    "display", "scriptlevel", "style", "data-diagram", "target", "rel",
    "data-file-path", "data-hash"
  ]
};

let diagramCounter = 0;
let markdownInitialized = false;

export function initMarkdownParser() {
  if (markdownInitialized) return;
  markdownInitialized = true;

  // 1. Initialize Mermaid for flowcharts and diagrams
  if (typeof mermaid !== "undefined") {
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          darkMode: true,
          background: "#181a1f",
          primaryColor: "#282c34",
          primaryTextColor: "#abb2bf",
          primaryBorderColor: "#61afef",
          lineColor: "#61afef",
          secondaryColor: "#21252b",
          tertiaryColor: "#1e2227"
        },
        securityLevel: "loose",
        flowchart: {
          htmlLabels: true,
          curve: "basis"
        }
      });
    } catch (err) {
      console.warn("Failed to initialize Mermaid:", err);
    }
  }

  // 2. Register marked-katex-extension if available
  if (typeof marked !== "undefined" && typeof markedKatex !== "undefined" && typeof katex !== "undefined") {
    try {
      marked.use(markedKatex({
        throwOnError: false,
        nonStandard: true
      }));
    } catch (err) {
      console.warn("Failed to initialize marked-katex-extension:", err);
    }
  }

  // 3. Register custom Marked renderer for code blocks (LaTeX, Mermaid, Flowchart)
  if (typeof marked !== "undefined") {
    marked.use({
      renderer: {
        code(token) {
          const codeText = typeof token === "string" ? token : ((token && token.text) || "");
          const lang = ((typeof token === "string" ? arguments[1] : (token && token.lang)) || "").trim().toLowerCase();

          // LaTeX / Math code block
          if (lang === "latex" || lang === "math" || lang === "tex" || lang === "katex") {
            if (typeof katex !== "undefined") {
              try {
                const mathHtml = katex.renderToString(codeText, {
                  displayMode: true,
                  throwOnError: false
                });
                return `<div class="latex-container">${mathHtml}</div>`;
              } catch (err) {
                return `<div class="latex-error">LaTeX error: ${escapeHtml(err.message)}</div><pre><code class="language-${escapeHtml(lang)}">${escapeHtml(codeText)}</code></pre>`;
              }
            }
          }

          // Flowchart or Mermaid diagram block
          if (lang === "mermaid" || lang === "flowchart") {
            // Check if flowchart.js syntax is used (e.g. st=>start: Start)
            const isFlowchartJs = lang === "flowchart" && /^\s*[\w\d]+\s*=>\s*(start|end|operation|subroutine|condition|inputoutput|parallel)/m.test(codeText);

            if (isFlowchartJs) {
              return `<div class="flowchart-container" data-diagram="flowchart-js"><pre class="diagram-code-source" style="display:none;">${escapeHtml(codeText)}</pre><div class="diagram-loading">Rendering flowchart...</div></div>`;
            }

            // Mermaid diagram (flowchart TD, graph, or implicit flowchart)
            let mermaidCode = codeText.trim();
            if (lang === "flowchart") {
              if (!/^(flowchart|graph)\b/i.test(mermaidCode)) {
                if (/^(TD|TB|BT|RL|LR)\b/i.test(mermaidCode)) {
                  mermaidCode = "flowchart " + mermaidCode;
                } else {
                  mermaidCode = "flowchart TD\n" + mermaidCode;
                }
              }
            }

            return `<div class="mermaid-container" data-diagram="mermaid"><pre class="diagram-code-source" style="display:none;">${escapeHtml(mermaidCode)}</pre><div class="diagram-loading">Rendering diagram...</div></div>`;
          }

          // Default code block
          const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
          return `<pre><code${langClass}>${escapeHtml(codeText)}</code></pre>`;
        }
      }
    });
  }
}

// Relative and Markdown Link Resolvers
export function normalizePath(pathStr) {
  if (!pathStr || typeof pathStr !== "string") return "";
  const parts = pathStr.replace(/\\/g, "/").split("/");
  const stack = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0) {
        stack.pop();
      } else {
        return null; // went above workspace root
      }
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

export function parseMarkdownLink(rawHref, currentFilePath = "") {
  if (!rawHref || typeof rawHref !== "string") return null;
  const trimmed = rawHref.trim();
  if (!trimmed) return null;

  // Block javascript: URLs completely
  if (/^javascript:/i.test(trimmed)) {
    return null;
  }

  // 1. Pure in-page anchor
  if (trimmed.startsWith("#")) {
    return {
      type: "anchor",
      hash: trimmed.slice(1)
    };
  }

  // 2. Protocol / External
  if (/^([a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(trimmed)) {
    // Check if it is a file:// protocol link referencing workspace
    if (trimmed.startsWith("file://")) {
      const cleanFileUri = trimmed.replace(/^file:\/\//, "");
      const wsMatch = cleanFileUri.match(/(?:^|\/)workspaces\/([^/]+)\/(.+)$/);
      if (wsMatch) {
        const [targetPath, hash] = wsMatch[2].split("#");
        const norm = normalizePath(targetPath);
        if (norm) {
          return {
            type: "file",
            workspace: wsMatch[1],
            path: norm,
            hash: hash || ""
          };
        }
      }
    }
    return {
      type: "external",
      url: trimmed
    };
  }

  // 3. Relative or workspace file path
  let [pathAndQuery, hash] = trimmed.split("#");
  let [cleanPath] = pathAndQuery.split("?");
  cleanPath = cleanPath.trim().replace(/\\/g, "/");

  try {
    cleanPath = decodeURIComponent(cleanPath);
  } catch (e) {}

  if (!cleanPath) {
    return hash ? { type: "anchor", hash } : null;
  }

  // Check if link starts with /workspaces/<ws>/<rel_path> or workspaces/<ws>/<rel_path>
  const wsMatch = cleanPath.match(/^\/?workspaces\/([^/]+)\/(.+)$/);
  if (wsMatch) {
    const norm = normalizePath(wsMatch[2]);
    if (norm) {
      return {
        type: "file",
        workspace: wsMatch[1],
        path: norm,
        hash: hash || ""
      };
    }
  }

  const isRootRelative = cleanPath.startsWith("/");
  const stripped = cleanPath.replace(/^\/+/, "");

  let baseDir = "";
  if (!isRootRelative && currentFilePath && currentFilePath.includes("/")) {
    baseDir = currentFilePath.substring(0, currentFilePath.lastIndexOf("/"));
  }

  let combined = baseDir ? `${baseDir}/${stripped}` : stripped;
  let normalized = normalizePath(combined);
  if (!normalized) return null;

  // Smart fallback: if normalized path doesn't exist in workspaceFilesMap,
  // but stripped (relative to workspace root) DOES exist, prefer stripped
  if (state.workspaceFilesMap.size > 0 && !state.workspaceFilesMap.has(normalized)) {
    const rootNorm = normalizePath(stripped);
    if (rootNorm && state.workspaceFilesMap.has(rootNorm)) {
      normalized = rootNorm;
    }
  }

  // Convenience extension check: e.g. [Link](README) -> README.md
  if (state.workspaceFilesMap.size > 0 && !state.workspaceFilesMap.has(normalized)) {
    if (state.workspaceFilesMap.has(normalized + ".md")) {
      normalized = normalized + ".md";
    }
  }

  // If path points to a directory with a README.md or index.md
  if (state.workspaceFilesMap.has(normalized) && state.workspaceFilesMap.get(normalized).is_dir) {
    if (state.workspaceFilesMap.has(`${normalized}/README.md`)) {
      normalized = `${normalized}/README.md`;
    } else if (state.workspaceFilesMap.has(`${normalized}/index.md`)) {
      normalized = `${normalized}/index.md`;
    }
  }

  return {
    type: "file",
    path: normalized,
    hash: hash || ""
  };
}

export function scrollToAnchorInContainer(container, hash) {
  if (!container || !hash) return false;
  const cleanHash = decodeURIComponent(hash.replace(/^#/, "")).trim();
  if (!cleanHash) return false;

  let target = null;
  try {
    target = container.querySelector("#" + CSS.escape(cleanHash));
  } catch (e) {}

  if (!target) {
    try {
      target = container.querySelector(`a[name="${CSS.escape(cleanHash)}"]`);
    } catch (e) {}
  }

  if (!target) {
    const slug = cleanHash.toLowerCase();
    try {
      target = container.querySelector("#" + CSS.escape(slug));
    } catch (e) {}
  }

  if (!target) {
    const targetSlug = cleanHash.toLowerCase().replace(/[^\w\u0400-\u04FF -]/g, "").replace(/\s+/g, "-");
    const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
    for (const h of headings) {
      const hSlug = (h.id || h.textContent.trim().toLowerCase())
        .replace(/[^\w\u0400-\u04FF -]/g, "")
        .replace(/\s+/g, "-");
      if (hSlug === targetSlug || h.id === cleanHash || h.textContent.trim().toLowerCase() === cleanHash.toLowerCase()) {
        target = h;
        break;
      }
    }
  }

  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  return false;
}

export function scrollToHashInTab(tabId, hash, retry = 2) {
  if (!hash) return;
  const tabInfo = state.openTabs.get(tabId);
  if (!tabInfo || !tabInfo.paneElement) return;

  const container = tabInfo.previewContainer || tabInfo.paneElement;
  const found = scrollToAnchorInContainer(container, hash);
  if (!found && retry > 0) {
    setTimeout(() => {
      scrollToHashInTab(tabId, hash, retry - 1);
    }, 200);
  }
}

export async function handleMarkdownLinkClick(e, anchor, previewContainer) {
  const rawHref = anchor.getAttribute("href");
  if (!rawHref) return;

  const currentFilePath = (previewContainer && previewContainer.dataset.basePath) || "";
  const linkInfo = parseMarkdownLink(rawHref, currentFilePath);
  if (!linkInfo) return;

  if (linkInfo.type === "anchor") {
    e.preventDefault();
    scrollToAnchorInContainer(previewContainer, linkInfo.hash);
    return;
  }

  if (linkInfo.type === "external") {
    e.preventDefault();
    window.open(linkInfo.url, "_blank", "noopener,noreferrer");
    return;
  }

  if (linkInfo.type === "file") {
    e.preventDefault();
    const targetPath = linkInfo.path;
    const targetHash = linkInfo.hash;

    // Check if link points to another workspace
    if (linkInfo.workspace && state.currentWorkspace && linkInfo.workspace !== state.currentWorkspace) {
      const switchOk = confirm(`File is in workspace "${linkInfo.workspace}". Switch to workspace "${linkInfo.workspace}"?`);
      if (switchOk) {
        selectWorkspace(linkInfo.workspace, false, "push");
        setTimeout(async () => {
          await openFile(targetPath);
          if (targetHash) {
            scrollToHashInTab("file:" + targetPath, targetHash);
          }
        }, 300);
      }
      return;
    }

    const tabId = "file:" + targetPath;
    const alreadyOpen = state.openTabs.has(tabId);

    await openFile(targetPath);

    if (targetHash) {
      setTimeout(() => {
        scrollToHashInTab(tabId, targetHash);
      }, alreadyOpen ? 50 : 250);
    }
  }
}

export async function renderMarkdown(markdownText, container, baseFilePath = "") {
  if (!container) return;
  initMarkdownParser();
  if (baseFilePath) {
    container.dataset.basePath = baseFilePath;
  }

  try {
    const rawHtml = marked.parse(markdownText || "");
    const cleanHtml = DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
    container.innerHTML = cleanHtml;

    // Add heading IDs if missing so anchor links work
    container.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(h => {
      if (!h.id) {
        const slug = h.textContent.trim().toLowerCase()
          .replace(/[^\w\u0400-\u04FF -]/g, "")
          .replace(/\s+/g, "-");
        if (slug) h.id = slug;
      }
    });

    // Annotate links
    container.querySelectorAll("a").forEach(a => {
      const href = a.getAttribute("href");
      if (!href) return;
      const info = parseMarkdownLink(href, baseFilePath);
      if (info) {
        if (info.type === "external") {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          if (!a.title) a.title = info.url;
        } else if (info.type === "file") {
          a.classList.add("md-file-link");
          if (!a.title) {
            a.title = `Open ${info.path}${info.hash ? '#' + info.hash : ''}`;
          }
        }
      }
    });

    // Run KaTeX auto-render for standard LaTeX delimiters \(...\), \[...\], $$...$$, $...$
    if (typeof renderMathInElement !== "undefined") {
      try {
        renderMathInElement(container, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true }
          ],
          throwOnError: false,
          ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"]
        });
      } catch (err) {
        console.warn("KaTeX auto-render error:", err);
      }
    }

    // Render Mermaid diagrams (flowcharts, graphs, etc.)
    await renderMermaidDiagrams(container);

    // Render flowchart.js diagrams if any
    renderFlowchartJsDiagrams(container);

  } catch (err) {
    console.error("Markdown rendering error:", err);
    container.innerHTML = `<div class="empty-state">Error rendering markdown: ${escapeHtml(err.message)}</div>`;
  }
}

export async function renderMermaidDiagrams(container) {
  if (typeof mermaid === "undefined") return;

  const elements = container.querySelectorAll('.mermaid-container[data-diagram="mermaid"]');
  if (elements.length === 0) return;

  for (const el of elements) {
    const sourceEl = el.querySelector(".diagram-code-source");
    const code = sourceEl ? sourceEl.textContent : "";
    if (!code) continue;

    const id = "mermaid-svg-" + (++diagramCounter) + "-" + Math.random().toString(36).substring(2, 7);
    try {
      const { svg, bindFunctions } = await mermaid.render(id, code);
      el.innerHTML = svg;
      if (typeof bindFunctions === "function") {
        bindFunctions(el);
      }
    } catch (err) {
      console.warn("Mermaid render error:", err);
      const tempEl = document.getElementById("d" + id) || document.getElementById(id);
      if (tempEl) tempEl.remove();

      el.innerHTML = `
        <div class="diagram-error">
          <span class="diagram-error-title">Flowchart render error:</span>
          <pre class="diagram-error-msg">${escapeHtml(err.message || String(err))}</pre>
        </div>
        <pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>
      `;
    }
  }
}

export function renderFlowchartJsDiagrams(container) {
  if (typeof flowchart === "undefined") return;

  const elements = container.querySelectorAll('.flowchart-container[data-diagram="flowchart-js"]');
  if (elements.length === 0) return;

  elements.forEach(el => {
    const sourceEl = el.querySelector(".diagram-code-source");
    const code = sourceEl ? sourceEl.textContent : "";
    if (!code) return;

    try {
      const chart = flowchart.parse(code);
      el.innerHTML = "";
      chart.drawSVG(el, {
        "x": 0,
        "y": 0,
        "line-width": 2,
        "line-length": 50,
        "text-margin": 10,
        "font-size": 14,
        "font-color": "#abb2bf",
        "line-color": "#61afef",
        "element-color": "#61afef",
        "fill": "#1e2227",
        "yes-text": "yes",
        "no-text": "no",
        "arrow-end": "block",
        "scale": 1,
        "symbols": {
          "start": { "font-color": "#98c379", "element-color": "#98c379", "fill": "#181a1f" },
          "end": { "font-color": "#e06c75", "element-color": "#e06c75", "fill": "#181a1f" }
        }
      });
    } catch (err) {
      console.warn("flowchart.js render error:", err);
      el.innerHTML = `
        <div class="diagram-error">
          <span class="diagram-error-title">Flowchart render error:</span>
          <pre class="diagram-error-msg">${escapeHtml(err.message || String(err))}</pre>
        </div>
        <pre><code class="language-flowchart">${escapeHtml(code)}</code></pre>
      `;
    }
  });
}
