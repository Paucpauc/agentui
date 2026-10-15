// Terminal and PTY WebSocket connection

import { state } from "./state.js";
import { dom } from "./dom.js";
import { activateTab } from "./tabs.js";

export function initTerminal() {
  const container = dom.terminalContainer;
  if (!container) return;
  container.innerHTML = "";

  state.term = new Terminal({
    cursorBlink: true,
    fontFamily: '"Fira Code", Monaco, Consolas, monospace',
    fontSize: 14,
    theme: {
      background: "#181a1f",
      foreground: "#abb2bf",
      cursor: "#528bcc",
      selectionBackground: "#3e4451",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#be5046",
      brightGreen: "#98c379",
      brightYellow: "#d19a66",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff"
    }
  });

  state.fitAddon = new FitAddon.FitAddon();
  state.term.loadAddon(state.fitAddon);
  state.term.open(container);
  state.fitAddon.fit();

  window.addEventListener("resize", () => {
    if (state.activeTabId === "terminal") {
      state.fitAddon.fit();
      sendResize();
    }
  });

  state.term.onData(data => {
    if (state.ptySocket && state.ptySocket.readyState === WebSocket.OPEN) {
      state.ptySocket.send(data);
    }
  });

  state.term.onBinary(data => {
    if (state.ptySocket && state.ptySocket.readyState === WebSocket.OPEN) {
      const buffer = new Uint8Array(data.length);
      for (let i = 0; i < data.length; ++i) {
        buffer[i] = data.charCodeAt(i) & 255;
      }
      state.ptySocket.send(buffer);
    }
  });

  if (state.currentWorkspace) {
    connectPty();
  }
}

export function sendResize() {
  if (state.ptySocket && state.ptySocket.readyState === WebSocket.OPEN && state.term) {
    const resizeMsg = JSON.stringify({
      type: "resize",
      cols: state.term.cols,
      rows: state.term.rows
    });
    state.ptySocket.send(resizeMsg);
  }
}

export function connectPty(initialPrompt) {
  if (state.ptySocket) {
    try {
      state.ptySocket.onclose = null;
      state.ptySocket.onerror = null;
      state.ptySocket.close();
    } catch (e) {}
    state.ptySocket = null;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  let url = `${protocol}//${window.location.host}/ws/pty`;
  const params = [];
  if (state.currentWorkspace) {
    params.push(`workspace=${encodeURIComponent(state.currentWorkspace)}`);
  }
  if (initialPrompt) {
    params.push(`prompt=${encodeURIComponent(initialPrompt)}`);
  }
  if (params.length > 0) {
    url += `?${params.join("&")}`;
  }

  const connBadge = dom.connBadge;
  if (connBadge) {
    connBadge.textContent = "Connecting...";
    connBadge.className = "badge";
  }

  state.ptySocket = new WebSocket(url);
  state.ptySocket.binaryType = "arraybuffer";

  state.ptySocket.onopen = () => {
    if (connBadge) {
      connBadge.textContent = "Connected";
      connBadge.className = "badge badge-connected";
    }
    if (state.fitAddon) state.fitAddon.fit();
    sendResize();
  };

  state.ptySocket.onmessage = (event) => {
    if (typeof event.data === "string") {
      state.term.write(event.data);
    } else {
      const bytes = new Uint8Array(event.data);
      state.term.write(bytes);
    }
  };

  state.ptySocket.onclose = (event) => {
    if (connBadge) {
      connBadge.textContent = "Disconnected";
      connBadge.className = "badge badge-disconnected";
    }
    if (event && event.code === 1008) {
      window.location.href = "/login";
    }
  };

  state.ptySocket.onerror = (err) => {
    console.error("PTY WebSocket Error:", err);
  };
}

// Executable prompt/task/plan file detection and execution
export function isExecutableFile(fileName) {
  if (!fileName || typeof fileName !== "string") return false;
  const baseName = fileName.split("/").pop() || fileName;
  return /prompt|task|plan/i.test(baseName);
}

export function executeFileInTty(fileName) {
  if (!fileName) return;
  const initialPrompt = `execute @${fileName}`;
  activateTab("terminal");
  if (state.term) {
    state.term.reset();
  }
  connectPty(initialPrompt);
}
