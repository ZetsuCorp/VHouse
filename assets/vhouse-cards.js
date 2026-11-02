/* VHouse VCard data boundary.
   Temporary browser adapter; a verified account/wallet adapter can replace it later.
   Do not treat preview records as verified NFTs or Solscan ownership records. */
(function () {
  "use strict";
  const CARDS_KEY = "vhouse-cards-v1";
  const ACTIVE_KEY = "vhouse-active-card-id";
  const LEGACY_KEY = "vhouse-vcard";
  const subscribers = new Set();
  let remoteAdapter = null;
  let cards = [];
  let activeId = null;
  const cardCopy = c => ({...c});
  const string = (v, max = 1024) => String(v == null ? "" : v).slice(0, max);
  function normalize(card) {
    if (!card || typeof card !== "object" || Array.isArray(card)) return null;
    const team = ["R", "P", "S"].includes(card.team) ? card.team : "R";
    return {
      id: string(card.id || makeId(), 128),
      name: string(card.name || "VCARD", 16),
      image: typeof card.image === "string" ? card.image : "",
      description: string(card.description || "", 100),
      team,
      level: Number.isFinite(Number(card.level)) ? Number(card.level) : 1,
      atk: Number.isFinite(Number(card.atk)) ? Number(card.atk) : 100,
      def: Number.isFinite(Number(card.def)) ? Number(card.def) : 100,
      footer: string(card.footer || "", 240),
      ownership: card.ownership && typeof card.ownership === "object"
        ? {...card.ownership} : {source: "local-preview", verified: false}
    };
  }
  function makeId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID() : "vcard-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }
  function readLocal() {
    let saved = null, selection = null;
    try {
      saved = JSON.parse(localStorage.getItem(CARDS_KEY) || "null");
      selection = localStorage.getItem(ACTIVE_KEY);
    } catch (error) { console.warn("VCard storage could not be read:", error); }
    let records = Array.isArray(saved) ? saved.map(normalize).filter(Boolean) : [];
    // Keep previously created cards from the original one-card prototype.
    if (!records.length) {
      try {
        const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
        const migrated = normalize(old);
        if (migrated) records = [migrated];
      } catch (error) { console.warn("Legacy VCard could not be read:", error); }
    }
    return {cards: records, activeCardId: records.some(c => c.id === selection)
      ? selection : (records[0]?.id || null)};
  }
  function notify() { subscribers.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  function setState(data) {
    cards = Array.isArray(data?.cards) ? data.cards.map(normalize).filter(Boolean) : [];
    activeId = cards.some(card => card.id === data?.activeCardId)
      ? data.activeCardId : (cards[0]?.id || null);
    notify();
  }
  function persist(nextCards, nextId) {
    // Never report success if storage failed; do not delete the old prototype record.
    localStorage.setItem(CARDS_KEY, JSON.stringify(nextCards));
    localStorage.setItem(ACTIVE_KEY, nextId || "");
  }
  setState(readLocal());
  window.addEventListener("storage", event => {
    if (remoteAdapter) return;
    if ([CARDS_KEY, ACTIVE_KEY, LEGACY_KEY].includes(event.key)) setState(readLocal());
  });
  const api = {
    getCards: () => cards.map(cardCopy),
    getActive: () => cardCopy(cards.find(c => c.id === activeId) || null || {}),
    getActiveId: () => activeId,
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    async saveCard(card) {
      const incoming = normalize({...card, id: card?.id || makeId()});
      if (!incoming) throw Error("Invalid VCard");
      let saved = incoming;
      if (remoteAdapter) {
        saved = normalize(await remoteAdapter.saveCard(incoming));
        if (!saved) throw Error("Card source did not return a card");
      }
      const next = [...cards.filter(c => c.id !== saved.id), saved];
      if (!remoteAdapter) persist(next, saved.id);
      setState({cards: next, activeCardId: saved.id});
      return cardCopy(saved);
    },
    async setActive(id) {
      if (!cards.some(c => c.id === id)) return false;
      if (remoteAdapter) await remoteAdapter.setActiveCard(id);
      else localStorage.setItem(ACTIVE_KEY, id);
      activeId = id;
      notify();
      return true;
    },
    async useAdapter(adapter) {
      // Future adapter: loadCards() -> {cards,activeCardId}, saveCard(card), setActiveCard(id).
      if (!adapter || !["loadCards", "saveCard", "setActiveCard"].every(x => typeof adapter[x] === "function")) {
        throw Error("VCard adapter requires loadCards, saveCard, and setActiveCard.");
      }
      const loaded = await adapter.loadCards();
      remoteAdapter = adapter;
      setState(loaded);
    }
  };
  // A missing active card should be represented by null, not an invented card.
  api.getActive = () => { const c = cards.find(c => c.id === activeId); return c ? cardCopy(c) : null; };
  window.VHouseCardStore = api;
})();
