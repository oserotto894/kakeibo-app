// localStorage based data layer. All data stays on-device only.
const STORAGE_KEY = "kakeibo.v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultState() {
  return {
    settings: {
      clientId: "",
      searchDays: 90,
      cards: [],
    },
    transactions: [], // {id, cardId, cardName, amount, dateISO, subject, settled, settledAt}
    settlements: [],  // {id, dateISO, amount, count}
    meta: { lastSyncAt: null },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // shallow-merge with defaults so new fields are backfilled on upgrade
    const d = defaultState();
    return {
      settings: { ...d.settings, ...(parsed.settings || {}) },
      transactions: parsed.transactions || [],
      settlements: parsed.settlements || [],
      meta: { ...d.meta, ...(parsed.meta || {}) },
    };
  } catch (e) {
    console.error("state load failed, resetting", e);
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const Storage = {
  get: () => state,

  addCard(card) {
    state.settings.cards.push({
      id: uid(),
      name: card.name,
      query: card.query,
      amountRegex: card.amountRegex,
    });
    saveState();
  },

  updateCard(id, patch) {
    const c = state.settings.cards.find((c) => c.id === id);
    if (c) Object.assign(c, patch);
    saveState();
  },

  removeCard(id) {
    state.settings.cards = state.settings.cards.filter((c) => c.id !== id);
    saveState();
  },

  setClientId(clientId) {
    state.settings.clientId = clientId.trim();
    saveState();
  },

  setSearchDays(days) {
    state.settings.searchDays = Number(days) || 90;
    saveState();
  },

  hasTransaction(id) {
    return state.transactions.some((t) => t.id === id);
  },

  addTransaction(tx) {
    if (Storage.hasTransaction(tx.id)) return false;
    state.transactions.push({ settled: false, settledAt: null, ...tx });
    saveState();
    return true;
  },

  addManualTransaction({ label, amount, note }) {
    const tx = {
      id: "manual-" + uid(),
      cardId: null,
      cardName: label && label.trim() ? label.trim() : "手動入力",
      amount,
      dateISO: new Date().toISOString(),
      subject: note || "",
    };
    Storage.addTransaction(tx);
    return tx;
  },

  removeTransaction(id) {
    state.transactions = state.transactions.filter((t) => t.id !== id);
    saveState();
  },

  unsettledTotal() {
    return state.transactions
      .filter((t) => !t.settled)
      .reduce((sum, t) => sum + t.amount, 0);
  },

  unsettledByCard() {
    const map = {};
    for (const t of state.transactions) {
      if (t.settled) continue;
      map[t.cardName] = (map[t.cardName] || 0) + t.amount;
    }
    return map;
  },

  unsettledTransactions() {
    return state.transactions
      .filter((t) => !t.settled)
      .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  },

  settleAll(note) {
    const targets = state.transactions.filter((t) => !t.settled);
    if (targets.length === 0) return null;
    const amount = targets.reduce((s, t) => s + t.amount, 0);
    const nowISO = new Date().toISOString();
    for (const t of targets) {
      t.settled = true;
      t.settledAt = nowISO;
    }
    const record = { id: uid(), dateISO: nowISO, amount, count: targets.length, note: note || "" };
    state.settlements.unshift(record);
    saveState();
    return record;
  },

  setLastSyncAt(iso) {
    state.meta.lastSyncAt = iso;
    saveState();
  },
};
