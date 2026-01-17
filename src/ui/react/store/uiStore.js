export function createUiStore(initialState = {}) {
  let state = {
    debugEnabled: false,
    snapshot: null,
    ...initialState
  };

  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    setState(partial) {
      const next = partial && typeof partial === 'object' ? { ...state, ...partial } : state;
      if (next === state) return;
      state = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

