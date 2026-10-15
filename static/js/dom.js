// Cached & Lazy DOM Element Selectors

export const dom = {
  get wsSelect() { return document.getElementById("workspace-select"); },
  get btnRefreshWs() { return document.getElementById("btn-refresh-ws"); },
  get btnCreateWs() { return document.getElementById("btn-create-workspace"); },
  get newWsInput() { return document.getElementById("new-workspace-name"); },
  get btnRefreshFiles() { return document.getElementById("btn-refresh-files"); },
  get btnNewFile() { return document.getElementById("btn-new-file"); },
  get btnUploadFile() { return document.getElementById("btn-upload-file"); },
  get btnDownloadWs() { return document.getElementById("btn-download-ws"); },
  get btnUploadWs() { return document.getElementById("btn-upload-ws"); },
  get btnQuickBackup() { return document.getElementById("btn-quick-backup"); },

  // Workspace Manager Modal
  get workspaceModal() { return document.getElementById("workspace-modal"); },
  get btnOpenWsModal() { return document.getElementById("btn-open-workspace-modal"); },
  get workspaceCardTrigger() { return document.getElementById("workspace-active-trigger"); },
  get currentWsName() { return document.getElementById("current-workspace-name"); },
  get btnCloseWsModal() { return document.getElementById("btn-close-workspace-modal"); },
  get btnDoneWsModal() { return document.getElementById("btn-done-workspace-modal"); },
  get modalNewWsInput() { return document.getElementById("modal-new-ws-name"); },
  get modalBtnCreateWs() { return document.getElementById("modal-btn-create-ws"); },
  get modalCreateWsError() { return document.getElementById("modal-create-ws-error"); },
  get modalWsSearchInput() { return document.getElementById("modal-ws-search"); },
  get modalWsCount() { return document.getElementById("modal-ws-count"); },
  get modalWsList() { return document.getElementById("modal-ws-list"); },

  // Upload ZIP modal
  get uploadZipModal() { return document.getElementById("upload-zip-modal"); },
  get btnCloseUploadModal() { return document.getElementById("btn-close-upload-modal"); },
  get btnCancelUpload() { return document.getElementById("btn-cancel-upload"); },
  get btnSubmitUpload() { return document.getElementById("btn-submit-upload"); },
  get modalDropzone() { return document.getElementById("modal-dropzone"); },
  get dropzoneLabel() { return document.getElementById("dropzone-label"); },
  get dropzoneFilename() { return document.getElementById("dropzone-filename"); },
  get zipFileInput() { return document.getElementById("zip-file-input"); },
  get radioWsNew() { return document.getElementById("radio-ws-new"); },
  get radioWsCurrent() { return document.getElementById("radio-ws-current"); },
  get labelWsCurrent() { return document.getElementById("label-ws-current"); },
  get uploadWsCurrentText() { return document.getElementById("upload-ws-current-text"); },
  get uploadWsNameInput() { return document.getElementById("upload-ws-name"); },
  get uploadOverwriteCheck() { return document.getElementById("upload-overwrite-check"); },
  get uploadStatusMsg() { return document.getElementById("upload-status-msg"); },

  // Upload Files modal
  get uploadFilesModal() { return document.getElementById("upload-files-modal"); },
  get btnCloseUploadFilesModal() { return document.getElementById("btn-close-upload-files-modal"); },
  get btnCancelUploadFiles() { return document.getElementById("btn-cancel-upload-files"); },
  get btnSubmitUploadFiles() { return document.getElementById("btn-submit-upload-files"); },
  get uploadFilesWsBadge() { return document.getElementById("upload-files-ws-badge"); },
  get uploadFilesDestDir() { return document.getElementById("upload-files-dest-dir"); },
  get modalFilesDropzone() { return document.getElementById("modal-files-dropzone"); },
  get filesDropzoneLabel() { return document.getElementById("files-dropzone-label"); },
  get filesDropzoneList() { return document.getElementById("files-dropzone-list"); },
  get fileUploadInput() { return document.getElementById("file-upload-input"); },
  get uploadFilesOverwriteCheck() { return document.getElementById("upload-files-overwrite-check"); },
  get uploadFilesStatusMsg() { return document.getElementById("upload-files-status-msg"); },

  // New File Inline Form
  get newFileForm() { return document.getElementById("new-file-form"); },
  get newFileInput() { return document.getElementById("new-file-name"); },
  get btnCreateFileSubmit() { return document.getElementById("btn-create-file-submit"); },
  get btnCreateFileCancel() { return document.getElementById("btn-create-file-cancel"); },

  // Tree & Layout
  get fileTreeContainer() { return document.getElementById("file-tree"); },
  get tabsBar() { return document.getElementById("tabs-bar"); },
  get tabViewsContainer() { return document.querySelector(".tab-views"); },
  get connBadge() { return document.getElementById("connection-badge"); },
  get terminalContainer() { return document.getElementById("terminal-container"); },
  get fileExplorerSec() { return document.querySelector(".file-explorer-sec"); },
  get sidebarEl() { return document.querySelector(".sidebar"); },

  // Context Menu
  get ctxMenu() { return document.getElementById("tree-context-menu"); },
  get ctxExecute() { return document.getElementById("ctx-menu-execute"); },
  get ctxUploadFolder() { return document.getElementById("ctx-menu-upload-folder"); },
  get ctxShare() { return document.getElementById("ctx-menu-share"); },
  get ctxRename() { return document.getElementById("ctx-menu-rename"); },
  get ctxDelete() { return document.getElementById("ctx-menu-delete"); },
  get ctxRestore() { return document.getElementById("ctx-menu-restore"); },
  get ctxQuickBackup() { return document.getElementById("ctx-menu-quick-backup"); },

  // Share Modal
  get shareLinkModal() { return document.getElementById("share-link-modal"); },
  get btnCloseShareModal() { return document.getElementById("btn-close-share-modal"); },
  get btnDoneShareModal() { return document.getElementById("btn-done-share-modal"); },
  get shareFileNameEl() { return document.getElementById("share-file-name"); },
  get shareExpirySelect() { return document.getElementById("share-expiry-select"); },
  get shareDownloadCheck() { return document.getElementById("share-download-check"); },
  get shareLinkUrlInput() { return document.getElementById("share-link-url"); },
  get btnCopyShareLink() { return document.getElementById("btn-copy-share-link"); },
  get shareCopyStatus() { return document.getElementById("share-copy-status"); },
  get shareOpenLink() { return document.getElementById("share-open-link"); },

  // User / Auth
  get userInfo() { return document.getElementById("user-info"); },
  get userName() { return document.getElementById("user-name"); },
  get btnLogout() { return document.getElementById("btn-logout"); },

  // Limits Widget
  get limitsContainer() { return document.getElementById("limits-container"); },
  get limitsBadges() { return document.getElementById("limits-badges"); },
  get limit5hBadge() { return document.getElementById("limit-5h-badge"); },
  get limit5hVal() { return document.getElementById("limit-5h-val"); },
  get limitWeeklyBadge() { return document.getElementById("limit-weekly-badge"); },
  get limitWeeklyVal() { return document.getElementById("limit-weekly-val"); },
  get btnRefreshLimits() { return document.getElementById("btn-refresh-limits"); },
  get limitsDropdown() { return document.getElementById("limits-dropdown"); },
  get limitsLastUpdated() { return document.getElementById("limits-last-updated"); },
  get limitsGroupsList() { return document.getElementById("limits-groups-list"); }
};

