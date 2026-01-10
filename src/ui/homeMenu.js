export class HomeMenu {
  constructor(options = {}) {
    this.root = options.root || null;
    this.onStartNew = typeof options.onStartNew === 'function' ? options.onStartNew : null;
    this.onContinue = typeof options.onContinue === 'function' ? options.onContinue : null;
    this.onRestart = typeof options.onRestart === 'function' ? options.onRestart : null;
    this.onAbandon = typeof options.onAbandon === 'function' ? options.onAbandon : null;
    this.onRestartCampaign = typeof options.onRestartCampaign === 'function' ? options.onRestartCampaign : null;
    this.onSave = typeof options.onSave === 'function' ? options.onSave : null;
    this.onLoadSave = typeof options.onLoadSave === 'function' ? options.onLoadSave : null;
    this.onClearSave = typeof options.onClearSave === 'function' ? options.onClearSave : null;

    this.startNewButton = document.getElementById('home-start-new');
    this.continueButton = document.getElementById('home-continue');
    this.restartButton = document.getElementById('home-restart');
    this.abandonButton = document.getElementById('home-abandon');
    this.restartCampaignButton = document.getElementById('home-restart-campaign');
    this.statusText = document.getElementById('home-status');
    this.saveButton = document.getElementById('home-save');
    this.loadButton = document.getElementById('home-load');
    this.clearSaveButton = document.getElementById('home-clear-save');
    this.saveInfoText = document.getElementById('home-save-info');

    this.tabButtons = Array.from(document.querySelectorAll('[data-home-tab]'));
    this.tabPanels = new Map();
    for (const panel of document.querySelectorAll('[data-home-panel]')) {
      const key = String(panel.getAttribute('data-home-panel') || '').trim();
      if (key) this.tabPanels.set(key, panel);
    }

    this.activeTab = null;
    this.bind();
  }

  bind() {
    for (const btn of this.tabButtons) {
      btn.addEventListener('click', () => {
        const key = String(btn.getAttribute('data-home-tab') || '').trim();
        if (key) this.setActiveTab(key);
      });
    }

    if (this.startNewButton) {
      this.startNewButton.addEventListener('click', () => this.onStartNew?.());
    }
    if (this.continueButton) {
      this.continueButton.addEventListener('click', () => this.onContinue?.());
    }
    if (this.restartButton) {
      this.restartButton.addEventListener('click', () => this.onRestart?.());
    }
    if (this.abandonButton) {
      this.abandonButton.addEventListener('click', () => this.onAbandon?.());
    }
    if (this.restartCampaignButton) {
      this.restartCampaignButton.addEventListener('click', () => this.onRestartCampaign?.());
    }
    if (this.saveButton) {
      this.saveButton.addEventListener('click', () => this.onSave?.());
    }
    if (this.loadButton) {
      this.loadButton.addEventListener('click', () => this.onLoadSave?.());
    }
    if (this.clearSaveButton) {
      this.clearSaveButton.addEventListener('click', () => this.onClearSave?.());
    }
  }

  setActiveTab(key) {
    const next = String(key || '').trim();
    if (!next) return;
    if (this.activeTab === next) return;
    this.activeTab = next;

    for (const btn of this.tabButtons) {
      const k = String(btn.getAttribute('data-home-tab') || '').trim();
      btn.classList.toggle('active', k === next);
    }

    for (const [k, panel] of this.tabPanels.entries()) {
      panel.classList.toggle('hidden', k !== next);
    }
  }

  setVisible(visible) {
    if (!this.root) return;
    this.root.classList.toggle('hidden', !visible);
    document.body.classList.toggle('mode-home', !!visible);
    document.body.classList.toggle('mode-game', !visible);
  }

  setCanContinue(canContinue, reason = '') {
    if (this.continueButton) {
      this.continueButton.disabled = !canContinue;
      this.continueButton.title = !canContinue && reason ? reason : '';
    }
  }

  setCanRestart(canRestart, reason = '') {
    if (this.restartButton) {
      this.restartButton.disabled = !canRestart;
      this.restartButton.title = !canRestart && reason ? reason : '';
    }
  }

  setCanAbandon(canAbandon, reason = '') {
    if (this.abandonButton) {
      this.abandonButton.disabled = !canAbandon;
      this.abandonButton.title = !canAbandon && reason ? reason : '';
    }
  }

  setStatus(text) {
    if (!this.statusText) return;
    this.statusText.textContent = String(text || '');
  }

  setSaveInfo(text) {
    if (!this.saveInfoText) return;
    this.saveInfoText.textContent = String(text || '');
  }

  setCanSave(canSave, reason = '') {
    if (this.saveButton) {
      this.saveButton.disabled = !canSave;
      this.saveButton.title = !canSave && reason ? reason : '';
    }
  }

  setCanLoadSave(canLoad, reason = '') {
    if (this.loadButton) {
      this.loadButton.disabled = !canLoad;
      this.loadButton.title = !canLoad && reason ? reason : '';
    }
  }

  setCanClearSave(canClear, reason = '') {
    if (this.clearSaveButton) {
      this.clearSaveButton.disabled = !canClear;
      this.clearSaveButton.title = !canClear && reason ? reason : '';
    }
  }
}
