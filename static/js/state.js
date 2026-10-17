// Shared Application State

export const state = {
  currentWorkspace: null,
  openTabs: new Map(), // tabId -> { type, path, title, element, paneElement, ... }
  activeTabId: "terminal",
  term: null,
  fitAddon: null,
  ptySocket: null,
  fileWatcherSocket: null,
  fileWatcherReconnectTimer: null,
  filePollTimer: null,
  loadFilesDebounceTimer: null,
  collapsedDirs: new Set(),
  expandedDirs: new Set(),
  workspaceFilesMap: new Map(), // path -> { name, is_dir, children }
  activeInlineRename: null,
  contextMenuTarget: null,
  currentShareTarget: null,
  currentFullscreenTab: null,
  selectedZipFile: null,
  selectedUploadFiles: [],
  workspacesList: [],
  activeWorkspaceRename: null
};

export function indexWorkspaceTree(tree) {
  state.workspaceFilesMap.clear();
  function traverse(nodes) {
    if (!nodes) return;
    for (const node of nodes) {
      state.workspaceFilesMap.set(node.path, node);
      if (node.children) traverse(node.children);
    }
  }
  traverse(tree);
}
