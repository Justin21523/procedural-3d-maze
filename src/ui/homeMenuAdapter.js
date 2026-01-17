export function createHomeMenuAdapter({ root = null, gameApi = null } = {}) {
  const state = {
    visible: true,
    activeTab: 'play',
    status: '',
    saveInfo: '',
    canContinue: false,
    continueReason: '',
    canRestart: false,
    restartReason: '',
    canAbandon: false,
    abandonReason: '',
    canRestartCampaign: true,
    canSave: false,
    saveReason: '',
    canLoadSave: false,
    loadSaveReason: '',
    canClearSave: false,
    clearSaveReason: ''
  };

  function push() {
    gameApi?.setUiState?.({ home: { ...state } });
  }

  function setVisible(visible) {
    state.visible = !!visible;
    if (root) root.classList.toggle('hidden', !state.visible);
    document.body.classList.toggle('mode-home', state.visible);
    document.body.classList.toggle('mode-game', !state.visible);
    push();
  }

  function setActiveTab(key) {
    const next = String(key || '').trim();
    if (!next) return;
    state.activeTab = next;
    push();
  }

  function setStatus(text) {
    state.status = String(text || '');
    push();
  }

  function setSaveInfo(text) {
    state.saveInfo = String(text || '');
    push();
  }

  function setCanContinue(canContinue, reason = '') {
    state.canContinue = !!canContinue;
    state.continueReason = String(reason || '');
    push();
  }

  function setCanRestart(canRestart, reason = '') {
    state.canRestart = !!canRestart;
    state.restartReason = String(reason || '');
    push();
  }

  function setCanAbandon(canAbandon, reason = '') {
    state.canAbandon = !!canAbandon;
    state.abandonReason = String(reason || '');
    push();
  }

  function setCanSave(canSave, reason = '') {
    state.canSave = !!canSave;
    state.saveReason = String(reason || '');
    push();
  }

  function setCanLoadSave(canLoad, reason = '') {
    state.canLoadSave = !!canLoad;
    state.loadSaveReason = String(reason || '');
    push();
  }

  function setCanClearSave(canClear, reason = '') {
    state.canClearSave = !!canClear;
    state.clearSaveReason = String(reason || '');
    push();
  }

  push();

  return {
    setVisible,
    setActiveTab,
    setStatus,
    setSaveInfo,
    setCanContinue,
    setCanRestart,
    setCanAbandon,
    setCanSave,
    setCanLoadSave,
    setCanClearSave
  };
}

