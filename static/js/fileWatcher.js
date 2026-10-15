// File Watching via WebSocket and Background Polling

import { state } from "./state.js";
import { loadFiles } from "./fileTree.js";
import { handleFilesChangedOnDisk } from "./tabs.js";

export function disconnectFileWatcher() {
  if (state.fileWatcherReconnectTimer) {
    clearTimeout(state.fileWatcherReconnectTimer);
    state.fileWatcherReconnectTimer = null;
  }
  if (state.fileWatcherSocket) {
    try {
      state.fileWatcherSocket.onclose = null;
      state.fileWatcherSocket.onerror = null;
      state.fileWatcherSocket.close();
    } catch (e) {}
    state.fileWatcherSocket = null;
  }
}

export function connectFileWatcher() {
  disconnectFileWatcher();
  if (!state.currentWorkspace) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws/files?workspace=${encodeURIComponent(state.currentWorkspace)}`;

  try {
    const ws = new WebSocket(url);
    state.fileWatcherSocket = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "files_changed" && (!msg.workspace || msg.workspace === state.currentWorkspace)) {
          scheduleLoadFiles(150);
          handleFilesChangedOnDisk(msg.changes);
        }
      } catch (e) {
        scheduleLoadFiles(150);
        handleFilesChangedOnDisk();
      }
    };

    ws.onclose = () => {
      if (state.fileWatcherSocket === ws) {
        state.fileWatcherSocket = null;
        state.fileWatcherReconnectTimer = setTimeout(() => {
          if (state.currentWorkspace) {
            connectFileWatcher();
          }
        }, 2000);
      }
    };

    ws.onerror = (err) => {
      console.warn("File watcher WebSocket error:", err);
    };
  } catch (err) {
    console.warn("Failed to connect file watcher WebSocket:", err);
  }
}

export function scheduleLoadFiles(delay = 150) {
  if (state.loadFilesDebounceTimer) {
    clearTimeout(state.loadFilesDebounceTimer);
  }
  state.loadFilesDebounceTimer = setTimeout(() => {
    loadFiles();
  }, delay);
}

export function startFilePolling() {
  if (state.filePollTimer) {
    clearInterval(state.filePollTimer);
  }
  state.filePollTimer = setInterval(() => {
    if (state.currentWorkspace && !document.hidden && !state.activeInlineRename) {
      loadFiles();
    }
  }, 3000);
}
