// Hololive OCG Manager - single-file vanilla JS app
// State, persistence, and three-tab rendering. No framework, no build.

// === Contact / feedback — empty fields are hidden. discord may be a username
// (shown as text) or an invite URL (shown as a link). ===
const CONTACT = {
  email: "paul91809@gmail.com",
  discord: "shinonome_inne",            // username (not linkable) → shown as text
  twitter: "https://x.com/paul91809",
};

const COLORS = ["white", "green", "red", "blue", "purple", "yellow", "colorless"];
const COLOR_LABEL = {
  white: "白", green: "綠", red: "紅", blue: "藍",
  purple: "紫", yellow: "黃", colorless: "無",
};
const TYPES = ["Oshi", "Holomem", "BuzzHolomem", "Support", "Cheer"];
const TYPE_LABEL = {
  Oshi: "推し", Holomem: "ホロメン", BuzzHolomem: "Buzzホロメン",
  Support: "サポート", Cheer: "エール",
};
const BLOOM_LEVELS = ["Debut", "1st", "2nd", "Spot"];
const RARITY_ORDER = ["C","U","R","RR","SR","OSR","UR","OUR","HR","SEC","OC","P","S","SY"];
function rarityRank(r) { const i = RARITY_ORDER.indexOf(r); return i < 0 ? 100 : i; }
// All printings sharing a card number (sorted lowest rarity first).
function variantsOf(num) { return state.byNumber[num] || []; }
// Total owned across every printing of a card number.
function ownedOfNumber(num) {
  return variantsOf(num).reduce((a, v) => a + (state.collection[v.id] || 0), 0);
}

// ============== STATE ==============
const state = {
  cards: {},      // id → card object
  collection: {}, // id → count (persisted)
  decks: [],      // [{name, oshi, main:{id:count}, cheer:{id:count}}] (persisted)
  currentDeckIdx: -1,
  filters: {     // persisted
    kw: "", colors: [], types: [], blooms: [], rarities: [], sets: [], tags: [],
    owned: "all", sort: "id", fold: true, talent: "",
  },
  talentMap: {},  // card name -> [talent, ...] (curated, loaded from talents.json)
  talentCategories: {}, // category -> [talent label, ...] (loaded from talent-categories.json)
  knownTalents: new Set(), // canonical talent names that actually match a card
  talentLabel: {}, // canonical talent -> display label (with alias/translation)
  byNumber: {},   // card_number -> [cards] index (built at init)
  expanded: new Set(), // card_numbers currently expanded in the folded grid
};

// The featured talent(s) of a card, as an array. Curated talents.json wins (it may
// list several talents for unit/combo cards); otherwise fall back to the card name
// for member-type cards, or [] for un-curated supports. These are CANONICAL names.
function talentsOf(card) {
  const curated = state.talentMap[card.name];
  if (curated && curated.length) return curated;
  if (curated) return [];  // explicitly curated as "no talent"
  if (["Holomem", "BuzzHolomem", "Oshi"].includes(card.type)) return [card.name];
  return [];
}

// A talent-categories entry may carry an alias/translation: "canonical  translation".
// The canonical (matchable) part is the entry itself if it's a known talent, else the
// known-talent prefix before the first space.
function canonicalTalent(entry) {
  if (state.knownTalents.has(entry)) return entry;
  const sp = entry.indexOf(" ");
  if (sp > 0 && state.knownTalents.has(entry.slice(0, sp))) return entry.slice(0, sp);
  return entry;
}

// Display label for a canonical talent (translation if the category file gave one).
function talentLabel(canonical) {
  return state.talentLabel[canonical] || canonical;
}

// Build knownTalents + canonical->label map (call after cards + both json loaded).
function buildTalentIndex() {
  state.knownTalents = new Set(Object.values(state.cards).flatMap(talentsOf));
  state.talentLabel = {};
  for (const entries of Object.values(state.talentCategories)) {
    for (const entry of entries || []) state.talentLabel[canonicalTalent(entry)] = entry;
  }
}

const LS = {
  load() {
    try {
      state.collection = JSON.parse(localStorage.getItem("collection") || "{}");
      state.decks = JSON.parse(localStorage.getItem("decks") || "[]");
      const f = JSON.parse(localStorage.getItem("filters") || "null");
      if (f) Object.assign(state.filters, f);
    } catch (e) { console.warn("storage load failed", e); }
  },
  save() {
    localStorage.setItem("collection", JSON.stringify(state.collection));
    localStorage.setItem("decks", JSON.stringify(state.decks));
    localStorage.setItem("filters", JSON.stringify(state.filters));
  },
};

// ============== INIT ==============
async function init() {
  const res = await fetch("cards.json");
  state.cards = await res.json();
  // Curated talent map (card name -> [talents]); optional, falls back to names.
  try {
    state.talentMap = await (await fetch("talents.json")).json();
  } catch (e) { state.talentMap = {}; }
  // Talent categories (category -> [talents]); drives the grouped filter dropdown.
  try {
    state.talentCategories = await (await fetch("talent-categories.json")).json();
  } catch (e) { state.talentCategories = {}; }
  buildTalentIndex();
  // Index printings by card number (rarities of the same card look identical in
  // the image, so we fold them together in the grid).
  for (const c of Object.values(state.cards)) {
    const k = c.card_number || c.id;
    (state.byNumber[k] || (state.byNumber[k] = [])).push(c);
  }
  for (const arr of Object.values(state.byNumber)) {
    arr.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));
  }
  // Stable index over card numbers for compact deck codes (16-bit per card).
  state.numberList = Object.keys(state.byNumber).sort();
  state.numberIndex = {};
  state.numberList.forEach((n, i) => (state.numberIndex[n] = i));
  // Stable index over printing ids — backup codes track exact rarity owned.
  state.idList = Object.keys(state.cards).sort();
  state.idIndex = {};
  state.idList.forEach((id, i) => (state.idIndex[id] = i));
  LS.load();

  setupDisclaimer();
  setupTabs();
  setupFilters();
  setupDeckList();
  setupScan();
  setupImportExport();
  setupBackupCode();
  setupModal();

  renderCollection();
  renderDeckList();
}

document.addEventListener("DOMContentLoaded", init);

// ============== TABS ==============
function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === name));
}

// Jump to the collection grid and flash a card's tile (used after scan).
function revealCardInCollection(id) {
  switchTab("collection");
  const num = state.cards[id]?.card_number || id;
  // ensure it's not hidden by an active filter
  if (filterCards().every((c) => (c.card_number || c.id) !== num)) {
    document.getElementById("reset-filters").click();
    return; // reset reloads the page; the card will be visible afterwards
  }
  const tile = document.querySelector(`#card-grid .card-item[data-number="${CSS.escape(num)}"]`)
    || document.querySelector(`#card-grid [data-count-id="${CSS.escape(id)}"]`)?.closest(".card-item");
  if (tile) {
    tile.scrollIntoView({ behavior: "smooth", block: "center" });
    tile.classList.add("flash");
    setTimeout(() => tile.classList.remove("flash"), 1500);
  }
}

// ============== COLLECTION TAB ==============
function setupFilters() {
  const cards = Object.values(state.cards);

  // Color chips
  renderChips("f-color", COLORS, state.filters.colors, COLOR_LABEL,
              (c) => `chip color-${c}`, "colors");

  // Type chips
  renderChips("f-type", TYPES, state.filters.types, TYPE_LABEL, () => "chip", "types");

  // Bloom chips
  renderChips("f-bloom", BLOOM_LEVELS, state.filters.blooms, null, () => "chip", "blooms");

  // Rarity chips (derived from data)
  const rarities = uniq(cards.map((c) => c.rarity).filter(Boolean));
  rarities.sort((a, b) => (RARITY_ORDER.indexOf(a) + 100) - (RARITY_ORDER.indexOf(b) + 100));
  renderChips("f-rarity", rarities, state.filters.rarities, null, () => "chip", "rarities");

  // Sets (derived)
  const sets = uniq(cards.map((c) => c.set));
  sets.sort();
  renderChips("f-set", sets, state.filters.sets, null, () => "chip", "sets");

  // Tags (derived)
  const tags = uniq(cards.flatMap((c) => c.tags || []));
  tags.sort();
  renderChips("f-tag", tags, state.filters.tags, null, () => "chip", "tags");

  // Owned state
  document.querySelectorAll("#f-owned .chip").forEach((b) => {
    b.classList.toggle("active", b.dataset.val === state.filters.owned);
    b.addEventListener("click", () => {
      state.filters.owned = b.dataset.val;
      document.querySelectorAll("#f-owned .chip").forEach((x) => x.classList.toggle("active", x === b));
      LS.save();
      renderCollection();
    });
  });

  // Talent filter: grouped dropdown driven by talent-categories.json
  rebuildTalentList();
  const talent = document.getElementById("f-talent");
  talent.value = state.filters.talent || "";
  talent.addEventListener("change", () => {
    state.filters.talent = talent.value;
    LS.save();
    renderCollection();
  });

  // Inputs
  const kw = document.getElementById("kw");
  kw.value = state.filters.kw;
  kw.addEventListener("input", debounce(() => {
    state.filters.kw = kw.value;
    LS.save();
    renderCollection();
  }, 200));

  const sort = document.getElementById("sort");
  sort.value = state.filters.sort;
  sort.addEventListener("change", () => {
    state.filters.sort = sort.value;
    LS.save();
    renderCollection();
  });

  const fold = document.getElementById("fold-same");
  fold.checked = state.filters.fold;
  fold.addEventListener("change", () => {
    state.filters.fold = fold.checked;
    LS.save();
    renderCollection();
  });

  setupFilterCollapse();

  document.getElementById("reset-filters").addEventListener("click", () => {
    state.filters = { kw: "", colors: [], types: [], blooms: [], rarities: [], sets: [], tags: [],
                      owned: "all", sort: "id", fold: true, talent: "" };
    LS.save();
    location.reload(); // ponytail: simplest way to reset chip UI
  });

  // Mobile filter drawer toggle
  const toggle = document.getElementById("filter-toggle");
  if (toggle) {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      document.body.classList.add("filters-open");
    });
  }
  // Tap backdrop or the ✕ pseudo-button area to close
  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("filters-open")) return;
    const filters = document.querySelector(".filters");
    if (!filters) return;
    const rect = filters.getBoundingClientRect();
    const inPanel = e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inPanel) {
      document.body.classList.remove("filters-open");
      return;
    }
    // ✕ pseudo-element area (top-right ~60px)
    if (e.clientY - rect.top < 36 && rect.right - e.clientX < 80) {
      document.body.classList.remove("filters-open");
    }
  });
}

// Make each filter group collapsible by clicking its <h4>. Collapsed keys persist.
function setupFilterCollapse() {
  const collapsed = new Set(JSON.parse(localStorage.getItem("collapsedGroups") || "[]"));
  // Default: hide the bulkiest chip groups on first run (no saved state yet).
  if (!localStorage.getItem("collapsedGroups")) {
    ["稀有度", "補充包", "標籤", "Bloom"].forEach((k) => collapsed.add(k));
  }
  document.querySelectorAll(".filters .filter-group").forEach((g) => {
    const h4 = g.querySelector("h4");
    if (!h4) return;
    const key = h4.textContent.trim();
    h4.classList.add("collapsible");
    if (collapsed.has(key)) g.classList.add("collapsed");
    h4.addEventListener("click", () => {
      g.classList.toggle("collapsed");
      if (g.classList.contains("collapsed")) collapsed.add(key); else collapsed.delete(key);
      localStorage.setItem("collapsedGroups", JSON.stringify([...collapsed]));
    });
  });
}

// Build the grouped talent <select>. Options come from talent-categories.json
// (categorised + pruned by the owner); if that's empty, fall back to a flat list
// of every talent assigned to a card.
function rebuildTalentList() {
  const sel = document.getElementById("f-talent");
  if (!sel) return;
  let html = `<option value="">（全部藝人）</option>`;
  const cats = state.talentCategories;
  if (cats && Object.keys(cats).length) {
    for (const [cat, talents] of Object.entries(cats)) {
      if (!talents || !talents.length) continue;
      html += `<optgroup label="${escapeAttr(cat)}">` +
        talents.map((t) => `<option value="${escapeAttr(canonicalTalent(t))}">${escapeText(t)}</option>`).join("") +
        `</optgroup>`;
    }
  } else {
    const talents = uniq(Object.values(state.cards).flatMap(talentsOf)).sort((a, b) => a.localeCompare(b, "ja"));
    html += talents.map((t) => `<option value="${escapeAttr(t)}">${escapeText(t)}</option>`).join("");
  }
  sel.innerHTML = html;
  sel.value = state.filters.talent || "";
}

function renderChips(containerId, options, selected, labelMap, classFn, stateKey) {
  const c = document.getElementById(containerId);
  c.innerHTML = "";
  options.forEach((opt) => {
    const b = document.createElement("button");
    b.className = classFn(opt) + (selected.includes(opt) ? " active" : "");
    b.textContent = labelMap ? (labelMap[opt] || opt) : opt;
    b.dataset.val = opt;
    b.addEventListener("click", () => {
      const arr = state.filters[stateKey];
      const i = arr.indexOf(opt);
      if (i >= 0) arr.splice(i, 1); else arr.push(opt);
      b.classList.toggle("active");
      LS.save();
      renderCollection();
    });
    c.appendChild(b);
  });
}

// Pure filter predicate shared by the collection grid and the deck picker.
function matchesFilters(c, f) {
  const kw = (f.kw || "").trim().toLowerCase();
  if (kw) {
    const hay = [c.name, c.id, c.card_number, c.ability_text,
                 ...(c.skills || []).map((s) => s.text)].join(" ").toLowerCase();
    if (!hay.includes(kw)) return false;
  }
  if (f.colors?.length && !c.color.some((x) => f.colors.includes(x))) return false;
  if (f.types?.length && !f.types.includes(c.type)) return false;
  if (f.blooms?.length && !f.blooms.includes(c.bloom_level)) return false;
  if (f.rarities?.length && !f.rarities.includes(c.rarity)) return false;
  if (f.sets?.length && !f.sets.includes(c.set)) return false;
  if (f.tags?.length && !c.tags?.some((t) => f.tags.includes(t))) return false;
  if (f.talent && !talentsOf(c).includes(f.talent)) return false;
  const owned = state.collection[c.id] || 0;
  if (f.owned === "owned" && owned === 0) return false;
  if (f.owned === "missing" && owned > 0) return false;
  return true;
}

function filterCards() {
  return Object.values(state.cards).filter((c) => matchesFilters(c, state.filters));
}

function sortCards(cards) {
  const k = state.filters.sort;
  return cards.slice().sort((a, b) => {
    if (k === "name") return a.name.localeCompare(b.name, "ja");
    if (k === "hp") return (b.hp || 0) - (a.hp || 0);
    if (k === "rarity") {
      return (RARITY_ORDER.indexOf(a.rarity) + 100) - (RARITY_ORDER.indexOf(b.rarity) + 100);
    }
    return a.id.localeCompare(b.id);
  });
}

function renderCollection() {
  const filtered = sortCards(filterCards());
  const grid = document.getElementById("card-grid");
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();

  let shownGroups = 0;
  if (state.filters.fold) {
    // Group the filtered cards by card number in one pass (Map keeps sort order).
    // Only variants that passed the filter form each group, so a rarity filter
    // still narrows correctly.
    const groups = new Map();
    for (const c of filtered) {
      const num = c.card_number || c.id;
      (groups.get(num) || groups.set(num, []).get(num)).push(c);
    }
    for (const [num, variants] of groups) frag.appendChild(groupTileEl(num, variants));
    shownGroups = groups.size;
  } else {
    filtered.forEach((c) => frag.appendChild(cardItemEl(c)));
    shownGroups = filtered.length;
  }
  grid.appendChild(frag);

  const label = state.filters.fold ? `${shownGroups} 種卡（${filtered.length} 版本）` : `${filtered.length} 張`;
  document.getElementById("result-count").textContent = label;
  updateCollectionTotal();
}

function updateCollectionTotal() {
  const total = Object.values(state.collection).reduce((a, b) => a + b, 0);
  const unique = Object.keys(state.collection).filter((k) => state.collection[k] > 0).length;
  document.getElementById("collection-total").textContent = `總收藏: ${total} 張 / ${unique} 種`;
}

// Common card-face markup: image (click = add), 🔍 zoom (click = detail), rarity badge.
function cardFaceHtml(card, badgeText) {
  return `
    <div class="card-thumb" data-add-id="${card.id}" title="點圖片 +1 收藏">
      <img loading="lazy" width="216" height="300" src="${card.image}" alt="${escapeAttr(card.name)}">
      <button class="zoom-btn" data-zoom="${card.id}" title="查看詳細" aria-label="查看詳細">🔍</button>
      <span class="add-hint">＋收藏</span>
      <span class="badge">${badgeText ?? (card.rarity || "")}</span>
    </div>`;
}

function wireCardFace(el, card) {
  el.querySelector(".card-thumb").addEventListener("click", (e) => {
    if (e.target.closest(".zoom-btn")) return; // zoom handled separately
    adjust(card.id, +1);
  });
  el.querySelector(".zoom-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    showCardModal(card, variantsOf(card.card_number || card.id));
  });
}

// Flat (unfolded) tile — also reused as an expanded variant sub-tile.
function cardItemEl(card) {
  const owned = state.collection[card.id] || 0;
  const el = document.createElement("div");
  el.className = "card-item" + (owned === 0 ? " owned-0" : "");
  el.innerHTML = cardFaceHtml(card) + `
    <div class="meta">
      <div class="name">${escapeText(card.name)}</div>
      <div class="id">${card.id}
        <span class="color-dots">${(card.color || []).map((c) => `<span class="dot" style="background:var(--c-${c})"></span>`).join("")}</span>
      </div>
    </div>
    <div class="ctrl">
      <button data-act="minus">−</button>
      <span class="count" data-count-id="${card.id}">${owned}</span>
      <button data-act="plus">＋</button>
    </div>`;
  wireCardFace(el, card);
  el.querySelector('[data-act="plus"]').addEventListener("click", () => adjust(card.id, +1));
  el.querySelector('[data-act="minus"]').addEventListener("click", () => adjust(card.id, -1));
  return el;
}

// Folded tile representing all printings of one card number. +/- and image-click
// act on the base printing (lowest rarity); the badge shows total owned across all.
function groupTileEl(num, variants) {
  // Rarity-order the variants so the base printing is primary and the strip reads
  // low→high rarity, regardless of the grid's current sort.
  variants = variants.slice().sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));
  const primary = variants[0];
  const total = ownedOfNumber(num);
  const el = document.createElement("div");
  el.className = "card-item" + (total === 0 ? " owned-0" : "");
  el.dataset.number = num;

  const multi = variants.length > 1;
  const badge = multi ? `${variants.length} 版本` : (primary.rarity || "");
  el.innerHTML = cardFaceHtml(primary, badge) + `
    <div class="meta">
      <div class="name">${escapeText(primary.name)}</div>
      <div class="id">${num}
        <span class="color-dots">${(primary.color || []).map((c) => `<span class="dot" style="background:var(--c-${c})"></span>`).join("")}</span>
      </div>
    </div>
    <div class="ctrl">
      <button data-act="minus">−</button>
      <span class="count" data-count-number="${num}">${total}</span>
      <button data-act="plus">＋</button>
      ${multi ? `<button class="expander" data-act="expand" title="展開各稀有度">${state.expanded.has(num) ? "▲" : `▾${variants.length}`}</button>` : ""}
    </div>
    ${multi && state.expanded.has(num) ? `<div class="variant-strip"></div>` : ""}`;

  wireCardFace(el, primary);
  el.querySelector('[data-act="plus"]').addEventListener("click", () => adjust(primary.id, +1));
  el.querySelector('[data-act="minus"]').addEventListener("click", () => adjustGroupDown(num));
  if (multi) {
    el.querySelector('[data-act="expand"]').addEventListener("click", () => {
      if (state.expanded.has(num)) state.expanded.delete(num); else state.expanded.add(num);
      renderCollection();
    });
    const strip = el.querySelector(".variant-strip");
    if (strip) variants.forEach((v) => strip.appendChild(variantChipEl(v)));
  }
  return el;
}

// Small per-rarity row shown when a group is expanded.
// Clicking the image adds +1 (same as the main tiles); 🔍 opens the detail.
function variantChipEl(card) {
  const owned = state.collection[card.id] || 0;
  const el = document.createElement("div");
  el.className = "variant-chip" + (owned === 0 ? " owned-0" : "");
  el.innerHTML = `
    <div class="vc-thumb" title="點圖片 +1 收藏">
      <img loading="lazy" width="72" height="100" src="${card.image}" alt="">
      <button class="zoom-btn vc-zoom" data-zoom="${card.id}" title="查看詳細" aria-label="查看詳細">🔍</button>
    </div>
    <span class="vc-rarity">${card.rarity || "?"}</span>
    <div class="vc-ctrl">
      <button data-act="minus">−</button>
      <span class="count" data-count-id="${card.id}">${owned}</span>
      <button data-act="plus">＋</button>
    </div>`;
  el.querySelector(".vc-thumb").addEventListener("click", (e) => {
    if (e.target.closest(".zoom-btn")) return;
    adjust(card.id, +1);
  });
  el.querySelector(".zoom-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    showCardModal(card, variantsOf(card.card_number || card.id));
  });
  el.querySelector('[data-act="plus"]').addEventListener("click", () => adjust(card.id, +1));
  el.querySelector('[data-act="minus"]').addEventListener("click", () => adjust(card.id, -1));
  return el;
}

// Decrement the group total: take one off the base printing if owned, else off
// whichever printing currently has the most copies.
function adjustGroupDown(num) {
  const variants = variantsOf(num);
  let target = variants.find((v) => (state.collection[v.id] || 0) > 0 && v === variants[0]);
  if (!target) {
    target = variants
      .filter((v) => (state.collection[v.id] || 0) > 0)
      .sort((a, b) => (state.collection[b.id] || 0) - (state.collection[a.id] || 0))[0];
  }
  if (target) adjust(target.id, -1);
}

function adjust(id, delta) {
  const cur = state.collection[id] || 0;
  const next = Math.max(0, cur + delta);
  if (next === 0) delete state.collection[id]; else state.collection[id] = next;
  LS.save();
  refreshCounts();
  if (state.currentDeckIdx >= 0) renderDeckEditor();
  return next;
}

// Update visible counts in place (no full re-render → no scroll jump).
function refreshCounts() {
  document.querySelectorAll("#card-grid [data-count-id]").forEach((span) => {
    const n = state.collection[span.dataset.countId] || 0;
    span.textContent = n;
    span.closest(".card-item, .variant-chip")?.classList.toggle("owned-0", n === 0);
  });
  document.querySelectorAll("#card-grid [data-count-number]").forEach((span) => {
    const total = ownedOfNumber(span.dataset.countNumber);
    span.textContent = total;
    span.closest(".card-item")?.classList.toggle("owned-0", total === 0);
  });
  updateCollectionTotal();
}

// ============== DECKS TAB ==============
function setupDeckList() {
  document.getElementById("new-deck").addEventListener("click", () => {
    state.decks.push({ name: `牌組 ${state.decks.length + 1}`, oshi: null, main: {}, cheer: {} });
    state.currentDeckIdx = state.decks.length - 1;
    LS.save();
    renderDeckList();
    renderDeckEditor();
  });
  document.getElementById("import-deck").addEventListener("click", importDeckPrompt);
}

function renderDeckList() {
  const ul = document.getElementById("deck-list");
  ul.innerHTML = "";
  state.decks.forEach((d, i) => {
    const mainCount = sumCounts(d.main);
    const cheerCount = sumCounts(d.cheer);
    const li = document.createElement("li");
    li.className = i === state.currentDeckIdx ? "active" : "";
    li.innerHTML = `<div>${escapeText(d.name)}</div>
      <div class="deck-stats">主 ${mainCount}/50 ・ 應援 ${cheerCount}/20 ${d.oshi ? "・ 推し ✓" : ""}</div>`;
    li.addEventListener("click", () => {
      state.currentDeckIdx = i;
      renderDeckList();
      renderDeckEditor();
    });
    ul.appendChild(li);
  });
  if (state.currentDeckIdx >= 0) renderDeckEditor();
}

function renderDeckEditor() {
  const editor = document.getElementById("deck-editor");
  if (state.currentDeckIdx < 0) {
    editor.innerHTML = '<div class="empty-state">選擇或新增一個牌組</div>';
    return;
  }
  const deck = state.decks[state.currentDeckIdx];
  if (!deck) return;

  editor.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "deck-header";
  header.innerHTML = `
    <input type="text" value="${escapeAttr(deck.name)}">
    <button data-act="code" title="複製可分享的牌組碼">牌組碼</button>
    <button data-act="json" title="下載此牌組 JSON">JSON</button>
    <button data-act="duplicate">複製</button>
    <button data-act="delete" class="danger">刪除</button>`;
  header.querySelector("input").addEventListener("input", (e) => {
    deck.name = e.target.value;
    LS.save();
    // Update only the sidebar label in place — re-rendering would recreate this
    // input and steal focus on every keystroke.
    const label = document.querySelector("#deck-list li.active > div:first-child");
    if (label) label.textContent = deck.name;
  });
  header.querySelector('[data-act="code"]').addEventListener("click", () => copyDeckCode(deck));
  header.querySelector('[data-act="json"]').addEventListener("click", () => downloadDeckJson(deck));
  header.querySelector('[data-act="delete"]').addEventListener("click", () => {
    if (!confirm(`刪除 "${deck.name}"？`)) return;
    state.decks.splice(state.currentDeckIdx, 1);
    state.currentDeckIdx = -1;
    LS.save();
    renderDeckList();
  });
  header.querySelector('[data-act="duplicate"]').addEventListener("click", () => {
    state.decks.push(JSON.parse(JSON.stringify({ ...deck, name: deck.name + " (副本)" })));
    state.currentDeckIdx = state.decks.length - 1;
    LS.save();
    renderDeckList();
  });
  editor.appendChild(header);

  // Oshi section
  editor.appendChild(deckSectionEl("推し (1)", deck.oshi ? [deck.oshi] : [], deck,
    (card) => card.type === "Oshi", "oshi", 1));

  // Main section
  editor.appendChild(deckSectionEl("主牌組 (50)", Object.keys(deck.main), deck,
    (card) => card.type === "Holomem" || card.type === "BuzzHolomem" || card.type === "Support",
    "main", 50));

  // Cheer section
  editor.appendChild(deckSectionEl("應援牌組 (20)", Object.keys(deck.cheer), deck,
    (card) => card.type === "Cheer", "cheer", 20));

  // Shopping list
  editor.appendChild(shoppingListEl(deck));
}

function deckSectionEl(title, ids, deck, predicate, section, target) {
  const sec = document.createElement("section");
  sec.className = "deck-section";

  let count;
  if (section === "oshi") count = deck.oshi ? 1 : 0;
  else count = sumCounts(deck[section]);

  const klass = count === target ? "ok" : (count > target ? "warn" : "");
  sec.innerHTML = `<h3>${title} <span class="count ${klass}">${count}/${target}</span></h3>`;

  const cards = document.createElement("div");
  cards.className = "deck-cards";

  ids.forEach((id) => {
    const c = state.cards[id];
    if (!c) return;
    const want = section === "oshi" ? 1 : deck[section][id];
    const owned = state.collection[id] || 0;
    const missing = Math.max(0, want - owned);
    const item = document.createElement("div");
    item.className = "deck-card" + (missing > 0 ? " missing" : "");
    item.innerHTML = `
      <img loading="lazy" width="216" height="300" src="${c.image}" alt="${escapeAttr(c.name)}">
      <span class="count ${missing > 0 ? "missing" : ""}">×${want}</span>`;
    item.title = `${c.name} (${c.id}) — 持有 ${owned}` + (missing ? ` — 缺 ${missing}` : "");
    item.addEventListener("click", (e) => {
      if (e.shiftKey) {
        // shift-click = remove all of this card
        if (section === "oshi") deck.oshi = null;
        else delete deck[section][id];
      } else {
        // click = -1
        if (section === "oshi") deck.oshi = null;
        else {
          deck[section][id] = (deck[section][id] || 0) - 1;
          if (deck[section][id] <= 0) delete deck[section][id];
        }
      }
      LS.save();
      renderDeckList();
    });
    cards.appendChild(item);
  });
  sec.appendChild(cards);

  // Picker to add cards
  sec.appendChild(pickerEl(deck, predicate, section));
  return sec;
}

// Per-section picker state (kept alive across re-renders so user keeps filters).
const pickerState = {};
function newPickerFilter() {
  return { kw: "", colors: [], types: [], blooms: [], rarities: [], sets: [], tags: [], owned: "all" };
}

// ---- Deckbuilding limits (hololive OCG rules) ----
// Section totals: 1 oshi / 50 main / 20 cheer.
const DECK_SECTION_MAX = { oshi: 1, main: 50, cheer: 20 };
function deckSectionTotal(deck, section) {
  return section === "oshi" ? (deck.oshi ? 1 : 0) : sumCounts(deck[section]);
}
// Copies of a given card NUMBER currently in a section (counts across rarities).
function deckCountByNumber(deck, section, cardNumber) {
  return Object.entries(deck[section]).reduce(
    (a, [id, n]) => a + (state.cards[id]?.card_number === cardNumber ? n : 0), 0);
}
// Per-card-number copy cap. Infinity = no per-card cap (only the section total).
// Exempt: Cheer cards, and Debut Holomem — those may repeat up to the section total.
function deckPerCardLimit(card, section) {
  if (section === "cheer") return Infinity;
  if (card.type === "Holomem" && card.bloom_level === "Debut") return Infinity;
  return 4;
}

function pickerEl(deck, predicate, section) {
  const ps = pickerState[section] || (pickerState[section] = { f: newPickerFilter(), expanded: false });
  const f = ps.f;
  const eligible = Object.values(state.cards).filter(predicate);

  const wrap = document.createElement("div");
  wrap.className = "deck-card-picker";

  const toolbar = document.createElement("div");
  toolbar.className = "picker-toolbar";
  toolbar.innerHTML = `
    <input type="text" placeholder="搜尋名字/卡號/技能文字…" value="${escapeAttr(f.kw)}">
    <button class="chip picker-filter-toggle">篩選 ${ps.expanded ? "▴" : "▾"}</button>
    <div class="picker-toggles">
      <button class="chip${f.owned === "all" ? " active" : ""}" data-owned="all">全部</button>
      <button class="chip${f.owned === "owned" ? " active" : ""}" data-owned="owned">持有</button>
      <button class="chip${f.owned === "missing" ? " active" : ""}" data-owned="missing">未持有</button>
    </div>`;
  wrap.appendChild(toolbar);

  const panel = document.createElement("div");
  panel.className = "picker-filters" + (ps.expanded ? "" : " collapsed");
  wrap.appendChild(panel);

  const results = document.createElement("div");
  results.className = "picker-results";
  wrap.appendChild(results);

  // Build collapsible filter chip groups (same axes as the collection panel).
  const rarities = uniq(eligible.map((c) => c.rarity).filter(Boolean)).sort((a, b) => rarityRank(a) - rarityRank(b));
  const sets = uniq(eligible.map((c) => c.set)).sort();
  const tags = uniq(eligible.flatMap((c) => c.tags || [])).sort();
  const addGroup = (title, options, key, labelMap, classFn) => {
    if (!options || !options.length) return;
    const g = document.createElement("div");
    g.className = "pf-group";
    g.innerHTML = `<span class="pf-title">${title}</span>`;
    const chips = document.createElement("div");
    chips.className = "chips chips-small";
    options.forEach((opt) => {
      const b = document.createElement("button");
      b.className = (classFn ? classFn(opt) : "chip") + (f[key].includes(opt) ? " active" : "");
      b.textContent = labelMap ? (labelMap[opt] || opt) : opt;
      b.addEventListener("click", () => {
        const i = f[key].indexOf(opt);
        if (i >= 0) f[key].splice(i, 1); else f[key].push(opt);
        b.classList.toggle("active");
        update();
      });
      chips.appendChild(b);
    });
    g.appendChild(chips);
    panel.appendChild(g);
  };
  addGroup("顏色", COLORS, "colors", COLOR_LABEL, (c) => `chip color-${c}`);
  if (section === "main") addGroup("類型", ["Holomem", "BuzzHolomem", "Support"], "types", TYPE_LABEL);
  addGroup("Bloom", BLOOM_LEVELS, "blooms");
  addGroup("稀有度", rarities, "rarities");
  addGroup("補充包", sets, "sets");
  addGroup("標籤", tags, "tags");

  const update = () => {
    const candidates = eligible.filter((c) => matchesFilters(c, f));
    candidates.sort((a, b) => {
      const oa = state.collection[a.id] || 0, ob = state.collection[b.id] || 0;
      if ((oa > 0) !== (ob > 0)) return ob - oa;
      return a.id.localeCompare(b.id);
    });
    const shown = candidates.slice(0, 60);
    results.innerHTML = shown.map((c) => {
      const owned = state.collection[c.id] || 0;
      const inDeck = section === "oshi" ? (deck.oshi === c.id ? 1 : 0) : (deck[section][c.id] || 0);
      return `<div class="picker-result${owned === 0 ? " owned-0" : ""}${inDeck ? " in-deck" : ""}" data-id="${c.id}" title="${escapeAttr(c.name + " (" + c.id + ")")}">
        <img loading="lazy" width="216" height="300" src="${c.image}" alt="">
        <button class="zoom-btn" data-zoom="${c.id}" title="查看詳細" aria-label="查看詳細">🔍</button>
        <div class="pr-meta">
          <span class="pr-id">${c.id}</span>
          <span class="pr-stats">${owned > 0 ? "持有 " + owned : "未持有"}${inDeck ? " ・組 " + inDeck : ""}</span>
        </div>
      </div>`;
    }).join("") + (candidates.length > shown.length
      ? `<div class="picker-more">… 共 ${candidates.length} 張，顯示前 60（縮小篩選看更多）</div>` : "");

    results.querySelectorAll(".picker-result").forEach((el) => {
      el.querySelector(".zoom-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        const c = state.cards[el.dataset.id];
        if (c) showCardModal(c, variantsOf(c.card_number || c.id));
      });
      el.addEventListener("click", (e) => {
        if (e.target.closest(".zoom-btn")) return;
        const c = state.cards[el.dataset.id];
        if (!c) return;
        if (section === "oshi") {
          deck.oshi = c.id;
        } else if (e.shiftKey) {
          deck[section][c.id] = Math.max(0, (deck[section][c.id] || 0) - 1);
          if (deck[section][c.id] === 0) delete deck[section][c.id];
        } else {
          if (deckSectionTotal(deck, section) >= DECK_SECTION_MAX[section]) {
            alert(`${section === "main" ? "主牌組" : "應援牌組"}已達 ${DECK_SECTION_MAX[section]} 張上限`);
            return;
          }
          const limit = deckPerCardLimit(c, section);
          if (limit !== Infinity && deckCountByNumber(deck, section, c.card_number) >= limit) {
            alert(`「${c.name}」(${c.card_number}) 已達 ${limit} 張上限`);
            return;
          }
          deck[section][c.id] = (deck[section][c.id] || 0) + 1;
        }
        LS.save();
        renderDeckList();
      });
    });
  };

  toolbar.querySelector("input").addEventListener("input", debounce((e) => { f.kw = e.target.value; update(); }, 150));
  toolbar.querySelector(".picker-filter-toggle").addEventListener("click", (e) => {
    ps.expanded = !ps.expanded;
    panel.classList.toggle("collapsed", !ps.expanded);
    e.target.textContent = `篩選 ${ps.expanded ? "▴" : "▾"}`;
  });
  toolbar.querySelectorAll(".picker-toggles .chip").forEach((b) => {
    b.addEventListener("click", () => {
      f.owned = b.dataset.owned;
      toolbar.querySelectorAll(".picker-toggles .chip").forEach((x) => x.classList.toggle("active", x === b));
      update();
    });
  });

  update();
  return wrap;
}

function shoppingListEl(deck) {
  const wrap = document.createElement("div");
  const missing = [];
  const collect = (id, want) => {
    const owned = state.collection[id] || 0;
    if (want > owned) missing.push({ id, name: state.cards[id]?.name || "?", need: want - owned });
  };
  if (deck.oshi) collect(deck.oshi, 1);
  Object.entries(deck.main).forEach(([id, n]) => collect(id, n));
  Object.entries(deck.cheer).forEach(([id, n]) => collect(id, n));
  if (!missing.length) {
    wrap.innerHTML = `<div style="color: var(--ok); padding: 12px; background: var(--panel); border-left: 3px solid var(--ok); border-radius: 4px;">✓ 所有需要的卡都已持有</div>`;
    return wrap;
  }
  wrap.className = "shopping-list";
  wrap.innerHTML = `<h4>缺少的卡 (${missing.reduce((a, b) => a + b.need, 0)} 張)</h4>
    <ul>${missing.map((m) => `<li>${m.id} ${escapeText(m.name)} ×${m.need}</li>`).join("")}</ul>`;
  return wrap;
}

// ============== SCAN TAB (perceptual-hash matching) ==============
// We match the camera frame against a precomputed 64-bit dHash of every card art
// (hashes.json, built by compute_hashes.py). dHash is robust to blur, lighting,
// and small rotation — far more reliable than OCR-ing the tiny card number.
let stream = null;
let cardHashes = null;          // { id: 16-char-hex } once loaded
let hashList = null;            // [{id, hi, lo}] precomputed 32-bit halves for fast hamming

// MUST mirror compute_hashes.py dhash() exactly: crop art region, grayscale,
// resize to 9x8, encode left>right per row. Same crop proportions, same bit order.
const ART_CROP = { x: 0.06, y: 0.10, w: 0.88, h: 0.52 }; // of the card rect

function setupScan() {
  document.getElementById("start-camera").addEventListener("click", startCamera);
  document.getElementById("stop-camera").addEventListener("click", stopCamera);
  document.getElementById("capture").addEventListener("click", captureAndMatch);
}

async function loadHashes() {
  if (cardHashes) return;
  document.getElementById("scan-status").textContent = "載入卡圖特徵…";
  try {
    const res = await fetch("hashes.json");
    cardHashes = await res.json();
  } catch (e) {
    cardHashes = {};
  }
  hashList = Object.entries(cardHashes).map(([id, hex]) => ({
    id,
    hi: parseInt(hex.slice(0, 8), 16),
    lo: parseInt(hex.slice(8, 16), 16),
  }));
}

async function startCamera() {
  try {
    await loadHashes();
    if (!hashList.length) {
      alert("尚未產生卡圖特徵 (hashes.json)。請先執行 python compute_hashes.py");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
      audio: false,
    });
    const v = document.getElementById("video");
    v.srcObject = stream;
    await v.play();
    layoutGuide();
    v.addEventListener("loadedmetadata", layoutGuide);
    window.addEventListener("resize", layoutGuide);
    document.getElementById("start-camera").disabled = true;
    document.getElementById("capture").disabled = false;
    document.getElementById("stop-camera").disabled = false;
    document.getElementById("scan-status").textContent = "把整張卡放滿框內、光線充足後按拍攝";
  } catch (e) {
    alert("無法開啟相機: " + e.message);
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  document.getElementById("video").srcObject = null;
  document.getElementById("start-camera").disabled = false;
  document.getElementById("capture").disabled = true;
  document.getElementById("stop-camera").disabled = true;
  document.getElementById("scan-status").textContent = "";
}

// Compute a 16-char-hex dHash from a source (image/canvas/video) given a card rect.
// rect = {x,y,w,h} in source pixels framing the whole card.
function dhashFromSource(src, rect) {
  // 1. crop to art region inside the card rect
  const ax = rect.x + rect.w * ART_CROP.x;
  const ay = rect.y + rect.h * ART_CROP.y;
  const aw = rect.w * ART_CROP.w;
  const ah = rect.h * ART_CROP.h;

  // 2. downscale art to 9x8 grayscale (high quality)
  const c = document.createElement("canvas");
  c.width = 9; c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, ax, ay, aw, ah, 0, 0, 9, 8);
  const data = ctx.getImageData(0, 0, 9, 8).data;

  // 3. grayscale (ITU-R 601-2, same as PIL "L") then row-wise left>right bits
  const gray = new Array(72);
  for (let i = 0; i < 72; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  let hex = "";
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const left = gray[row * 9 + col];
      const right = gray[row * 9 + col + 1];
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function popcount(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

function hammingHex(hex, entry) {
  const hi = parseInt(hex.slice(0, 8), 16) ^ entry.hi;
  const lo = parseInt(hex.slice(8, 16), 16) ^ entry.lo;
  return popcount(hi) + popcount(lo);
}

const CARD_ASPECT = 0.716; // w / h of a hololive card

// Geometry of the displayed video content inside the <video> box, accounting for
// object-fit: contain letterboxing. Returns element-space rect + scale to video px.
function displayedVideoRect(v) {
  const vw = v.videoWidth, vh = v.videoHeight;
  const ew = v.clientWidth, eh = v.clientHeight;
  const scale = Math.min(ew / vw, eh / vh) || 1;
  const dispW = vw * scale, dispH = vh * scale;
  return { offX: (ew - dispW) / 2, offY: (eh - dispH) / 2, dispW, dispH, scale };
}

// Size and place the on-screen guide frame so it sits *inside* the visible image
// (not the letterbox), card-shaped. Called on play and resize.
function layoutGuide() {
  const v = document.getElementById("video");
  const guide = document.querySelector(".guide-frame");
  if (!v || !guide || !v.videoWidth) return;
  const { offX, offY, dispW, dispH } = displayedVideoRect(v);
  let gh = dispH * 0.9;
  let gw = gh * CARD_ASPECT;
  if (gw > dispW * 0.92) { gw = dispW * 0.92; gh = gw / CARD_ASPECT; }
  guide.style.transform = "none";
  guide.style.height = gh + "px";
  guide.style.width = gw + "px";
  guide.style.left = (offX + (dispW - gw) / 2) + "px";
  guide.style.top = (offY + (dispH - gh) / 2) + "px";
}

// Map the *actually rendered* guide frame to video pixels. Reading the real DOM
// rect means the cropped region always matches what the user sees, whatever the
// orientation/letterboxing.
function guideRectInVideo(v) {
  const guide = document.querySelector(".guide-frame");
  const gr = guide.getBoundingClientRect();
  const vr = v.getBoundingClientRect();
  const vw = v.videoWidth, vh = v.videoHeight;
  const scale = Math.min(vr.width / vw, vr.height / vh) || 1;
  const offX = vr.left + (vr.width - vw * scale) / 2;
  const offY = vr.top + (vr.height - vh * scale) / 2;
  let x = (gr.left - offX) / scale;
  let y = (gr.top - offY) / scale;
  let w = gr.width / scale;
  let h = gr.height / scale;
  // clamp into the frame
  x = Math.max(0, Math.min(x, vw));
  y = Math.max(0, Math.min(y, vh));
  w = Math.min(w, vw - x);
  h = Math.min(h, vh - y);
  return { x, y, w, h };
}

async function captureAndMatch() {
  const v = document.getElementById("video");
  await loadHashes();
  if (!hashList || !hashList.length) {
    document.getElementById("scan-status").textContent = "沒有卡圖特徵可比對";
    return;
  }
  document.getElementById("scan-status").textContent = "比對中…";

  const rect = guideRectInVideo(v);

  // Multi-crop jitter: the card is rarely framed perfectly, so hash a few slightly
  // shifted/scaled crops and score each DB card by its BEST (min) distance across
  // them. Cheap (~7 × 2446 hamming ops) and markedly more forgiving of misalignment.
  const jitters = [
    { dx: 0, dy: 0, ds: 0 },
    { dx: -0.04, dy: 0, ds: 0 }, { dx: 0.04, dy: 0, ds: 0 },
    { dx: 0, dy: -0.04, ds: 0 }, { dx: 0, dy: 0.04, ds: 0 },
    { dx: 0, dy: 0, ds: 0.05 }, { dx: 0, dy: 0, ds: -0.05 },
  ];
  const queryHashes = jitters.map((j) => {
    const r = {
      x: rect.x + rect.w * j.dx - rect.w * j.ds / 2,
      y: rect.y + rect.h * j.dy - rect.h * j.ds / 2,
      w: rect.w * (1 + j.ds),
      h: rect.h * (1 + j.ds),
    };
    return dhashFromSource(v, r);
  });

  const ranked = hashList
    .map((e) => ({ id: e.id, dist: Math.min(...queryHashes.map((h) => hammingHex(h, e))) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 6);

  // Snapshot the framed region for display
  const snap = document.createElement("canvas");
  snap.width = Math.round(rect.w);
  snap.height = Math.round(rect.h);
  snap.getContext("2d").drawImage(v, rect.x, rect.y, rect.w, rect.h, 0, 0, snap.width, snap.height);

  showScanResult(ranked, snap.toDataURL("image/jpeg", 0.6));
}

function showScanResult(ranked, snapUrl) {
  const box = document.getElementById("scan-result");
  const best = ranked[0];
  // dHash: <=10 strong, <=16 plausible, >16 weak. Show all 6, flag confidence on top.
  const confidence = best.dist <= 10 ? "高" : best.dist <= 16 ? "中" : "低";
  document.getElementById("scan-status").textContent = `最佳匹配距離 ${best.dist}/64 (信心: ${confidence})`;

  box.innerHTML = `
    <div class="scan-snap"><img src="${snapUrl}" alt="拍攝畫面"><span>你的拍攝</span></div>
    <p class="scan-hint">點選正確的卡加入收藏（依相似度排序）：</p>
    <div class="scan-candidates">${ranked.map((r, i) => {
      const c = state.cards[r.id];
      if (!c) return "";
      const owned = state.collection[r.id] || 0;
      return `<div class="scan-cand${i === 0 ? " best" : ""}" data-id="${r.id}" title="${escapeAttr(c.name)} (${r.id})">
        <img loading="lazy" width="216" height="300" src="${c.image}" alt="">
        <div class="cand-meta">
          <span class="cand-id">${r.id}</span>
          <span class="cand-dist">距離 ${r.dist}${owned ? " ・持有 " + owned : ""}</span>
        </div>
      </div>`;
    }).join("")}</div>
    <button class="secondary" id="scan-dismiss">關閉</button>`;

  box.querySelectorAll(".scan-cand").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      adjust(id, +1);
      const name = escapeText(state.cards[id]?.name || id);
      if (document.getElementById("continuous").checked) {
        // bulk mode: stay on the scan tab, ready for the next card
        document.getElementById("scan-status").textContent = `已加入 ${id}（持有 ${state.collection[id]}）`;
        box.innerHTML = `<p class="scan-ok">✓ 已加入 ${name}，請拍下一張</p>`;
      } else {
        // jump to the collection page and highlight the card just added
        box.innerHTML = "";
        document.getElementById("scan-status").textContent = `已加入 ${name}`;
        revealCardInCollection(id);
      }
    });
  });
  box.querySelector("#scan-dismiss").addEventListener("click", () => (box.innerHTML = ""));
  // On mobile the camera fills the top; bring the candidate list into view.
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ============== DECK CODE (reversible, NOT a hash) ==============
// Layout (bytes): [ver=1][hasOshi:1][oshiIdx:2]? [mainN:1][mainN×(idx:2,cnt:1)]
//                 [cheerN:1][cheerN×(idx:2,cnt:1)]   then Base64url.
// Cards are referenced by 16-bit index into the sorted card-number list, so a code
// stays valid across rarity/printing changes and covers up to 65k cards.
const DECK_CODE_PREFIX = "HOCG1-";

function b64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(str);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Sum a deck section's counts by card number (printings of the same card merge).
function sectionByNumber(obj) {
  const m = {};
  for (const [id, c] of Object.entries(obj)) {
    const n = state.cards[id]?.card_number;
    if (n) m[n] = (m[n] || 0) + c;
  }
  return m;
}

function encodeDeck(deck) {
  const bytes = [1];
  const pushIdx = (num) => {
    const i = state.numberIndex[num] ?? 0xffff;
    bytes.push((i >> 8) & 0xff, i & 0xff);
  };
  const oshiNum = deck.oshi ? state.cards[deck.oshi]?.card_number : null;
  if (oshiNum) { bytes.push(1); pushIdx(oshiNum); } else { bytes.push(0); }
  for (const sec of ["main", "cheer"]) {
    const m = sectionByNumber(deck[sec]);
    const entries = Object.entries(m).slice(0, 255);
    bytes.push(entries.length);
    for (const [num, c] of entries) { pushIdx(num); bytes.push(Math.min(255, c)); }
  }
  return DECK_CODE_PREFIX + b64urlEncode(bytes);
}

function decodeDeck(code) {
  code = code.trim();
  if (code.startsWith(DECK_CODE_PREFIX)) code = code.slice(DECK_CODE_PREFIX.length);
  const b = b64urlDecode(code);
  let p = 0;
  if (b[p++] !== 1) throw new Error("不支援的牌組碼版本");
  const numToPrimaryId = (idx) => {
    const num = state.numberList[idx];
    if (!num) return null;
    const v = state.byNumber[num];
    return v && v[0] ? v[0].id : null;
  };
  const deck = { name: "匯入的牌組", oshi: null, main: {}, cheer: {} };
  if (b[p++] === 1) {
    const idx = (b[p] << 8) | b[p + 1]; p += 2;
    deck.oshi = numToPrimaryId(idx);
  }
  for (const sec of ["main", "cheer"]) {
    const n = b[p++];
    for (let i = 0; i < n; i++) {
      const idx = (b[p] << 8) | b[p + 1]; p += 2;
      const cnt = b[p++];
      const id = numToPrimaryId(idx);
      if (id) deck[sec][id] = cnt;
    }
  }
  return deck;
}

function copyDeckCode(deck) {
  const code = encodeDeck(deck);
  const note = "\n\n（此牌組碼僅供本頁使用，與官方 Deck Log 不互通）";
  navigator.clipboard?.writeText(code).then(
    () => alert("牌組碼已複製到剪貼簿：\n\n" + code + note),
    () => prompt("複製失敗，請手動複製牌組碼：" + note, code),
  );
}

function downloadDeckJson(deck) {
  const blob = new Blob([JSON.stringify(deck, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `deck-${(deck.name || "deck").replace(/[^\w一-鿿ぁ-ヿ]/g, "_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importDeckPrompt() {
  const input = prompt("貼上牌組碼 (HOCG1-…) 或牌組 JSON：\n\n⚠️ 注意：此牌組碼僅供本頁使用，與官方 Deck Log 的牌組碼不互通。");
  if (!input) return;
  let deck;
  try {
    deck = input.trim().startsWith("{") ? JSON.parse(input) : decodeDeck(input);
  } catch (e) {
    alert("無法解析：" + e.message);
    return;
  }
  // normalise shape
  deck = { name: deck.name || "匯入的牌組", oshi: deck.oshi || null,
           main: deck.main || {}, cheer: deck.cheer || {} };
  state.decks.push(deck);
  state.currentDeckIdx = state.decks.length - 1;
  LS.save();
  renderDeckList();
  switchTab("decks");
}

// ============== FULL BACKUP CODE (reversible, collection + decks) ==============
// Compact binary of the whole library + all decks, by 16-bit printing-id index, so
// exact rarities are preserved. Long but pasteable; for big collections use the
// JSON file instead. Prefix HOCGX1-.
const BACKUP_CODE_PREFIX = "HOCGX1-";

function encodeBackup() {
  const bytes = [1];
  const push16 = (n) => bytes.push((n >> 8) & 0xff, n & 0xff);
  const pushIdEntry = (id, cnt) => { push16(state.idIndex[id] ?? 0xffff); bytes.push(Math.min(255, cnt)); };

  // collection: 3-byte count, then (idIdx:2, cnt:1) per owned card
  const coll = Object.entries(state.collection).filter(([, c]) => c > 0);
  bytes.push((coll.length >> 16) & 0xff, (coll.length >> 8) & 0xff, coll.length & 0xff);
  for (const [id, c] of coll) pushIdEntry(id, c);

  // decks
  const enc = new TextEncoder();
  bytes.push(Math.min(255, state.decks.length));
  for (const d of state.decks.slice(0, 255)) {
    const nameBytes = enc.encode(d.name || "");
    bytes.push(Math.min(255, nameBytes.length));
    for (const b of nameBytes.slice(0, 255)) bytes.push(b);
    if (d.oshi && state.idIndex[d.oshi] != null) { bytes.push(1); push16(state.idIndex[d.oshi]); } else bytes.push(0);
    for (const sec of ["main", "cheer"]) {
      const entries = Object.entries(d[sec] || {});
      push16(entries.length);
      for (const [id, c] of entries) pushIdEntry(id, c);
    }
  }
  return BACKUP_CODE_PREFIX + b64urlEncode(bytes);
}

function decodeBackup(code) {
  code = code.trim();
  if (code.startsWith(BACKUP_CODE_PREFIX)) code = code.slice(BACKUP_CODE_PREFIX.length);
  const b = b64urlDecode(code);
  let p = 0;
  if (b[p++] !== 1) throw new Error("不支援的備份碼版本");
  const read16 = () => { const v = (b[p] << 8) | b[p + 1]; p += 2; return v; };
  const idAt = (idx) => state.idList[idx] || null;

  const collection = {};
  const collN = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]; p += 3;
  for (let i = 0; i < collN; i++) {
    const id = idAt(read16()); const c = b[p++];
    if (id) collection[id] = c;
  }
  const dec = new TextDecoder();
  const decks = [];
  const deckN = b[p++];
  for (let i = 0; i < deckN; i++) {
    const nameLen = b[p++];
    const name = dec.decode(b.slice(p, p + nameLen)); p += nameLen;
    const deck = { name, oshi: null, main: {}, cheer: {} };
    if (b[p++] === 1) deck.oshi = idAt(read16());
    for (const sec of ["main", "cheer"]) {
      const n = read16();
      for (let j = 0; j < n; j++) { const id = idAt(read16()); const c = b[p++]; if (id) deck[sec][id] = c; }
    }
    decks.push(deck);
  }
  return { collection, decks };
}

function setupBackupCode() {
  const dlg = document.getElementById("backup-code");
  if (!dlg) return;
  const ta = document.getElementById("backup-code-text");
  document.getElementById("backup-code-link").addEventListener("click", () => { ta.value = ""; dlg.showModal(); });
  document.getElementById("backup-code-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.getElementById("backup-gen").addEventListener("click", () => {
    ta.value = encodeBackup();
    ta.select();
    navigator.clipboard?.writeText(ta.value).catch(() => {});
  });
  document.getElementById("backup-restore").addEventListener("click", () => {
    const code = ta.value.trim();
    if (!code) { alert("請先貼上備份碼"); return; }
    if (!confirm("從備份碼還原會覆蓋現有的收藏和牌組，繼續？")) return;
    try {
      const data = decodeBackup(code);
      state.collection = data.collection;
      state.decks = data.decks;
      state.currentDeckIdx = -1;
      LS.save();
      renderCollection();
      renderDeckList();
      dlg.close();
      alert("還原成功");
    } catch (e) {
      alert("還原失敗：" + e.message);
    }
  });
}

// ============== IMPORT / EXPORT (full backup) ==============
function setupImportExport() {
  document.getElementById("export-btn").addEventListener("click", () => {
    const data = {
      version: 1,
      exported_at: new Date().toISOString(),
      collection: state.collection,
      decks: state.decks,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hololive-tcg-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("import-btn").addEventListener("click", () =>
    document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("匯入會覆蓋現有的收藏和牌組，繼續？")) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      state.collection = data.collection || {};
      state.decks = data.decks || [];
      state.currentDeckIdx = -1;
      LS.save();
      renderCollection();
      renderDeckList();
      alert("匯入成功");
    } catch (err) {
      alert("匯入失敗: " + err.message);
    }
    e.target.value = "";
  });
}

// ============== DISCLAIMER / ABOUT ==============
// Show disclaimer once per browser session on entry (sessionStorage clears on tab close).
function setupDisclaimer() {
  const dlg = document.getElementById("disclaimer");
  if (!dlg) return;
  document.getElementById("disclaimer-ok").addEventListener("click", () => dlg.close());
  if (!sessionStorage.getItem("disclaimer_seen")) {
    dlg.showModal();
    sessionStorage.setItem("disclaimer_seen", "1");
  }

  // About / contact dialog
  const about = document.getElementById("about");
  const contact = document.getElementById("about-contact");
  const rows = [];
  if (CONTACT.email) rows.push(`✉️ <a href="mailto:${escapeAttr(CONTACT.email)}">${escapeText(CONTACT.email)}</a>`);
  if (CONTACT.discord) {
    rows.push(/^https?:\/\//.test(CONTACT.discord)
      ? `💬 <a href="${escapeAttr(CONTACT.discord)}" target="_blank" rel="noopener">Discord</a>`
      : `💬 Discord: <code>${escapeText(CONTACT.discord)}</code>`);
  }
  if (CONTACT.twitter) rows.push(`𝕏 <a href="${escapeAttr(CONTACT.twitter)}" target="_blank" rel="noopener">X (Twitter)</a>`);
  contact.innerHTML = rows.length
    ? `<h3 class="about-ct">問題反饋／聯絡</h3><ul class="contact-list">${rows.map((r) => `<li>${r}</li>`).join("")}</ul>`
    : `<p class="about-ct-empty">（聯絡資訊尚未設定）</p>`;
  document.getElementById("about-link").addEventListener("click", () => about.showModal());
  document.getElementById("about-close").addEventListener("click", () => about.close());
  about.addEventListener("click", (e) => { if (e.target === about) about.close(); });
}

// ============== MODAL ==============
function setupModal() {
  const modal = document.getElementById("card-modal");
  document.getElementById("card-modal-close").addEventListener("click", () => modal.close());
  // Click the dark backdrop (the dialog element itself, outside its content) to close.
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.close();
  });
}

function showCardModal(card, variants) {
  const body = document.getElementById("card-modal-body");
  const skillsHtml = (card.skills || []).map((s) => {
    const icons = (s.icons || []).filter((x) => x && !"◇白緑赤青紫黄".includes(x));
    const iconTags = icons.map((x) => `<span class="skill-icon">${escapeText(x)}</span>`).join("");
    return `<div class="skill">
      ${s.header ? `<div class="header">${escapeText(s.header)}${iconTags}</div>` : iconTags}
      <div>${escapeText(s.text)}</div>
    </div>`;
  }).join("");

  // Sibling printings (same card number, different rarity / finish)
  const sibs = (variants && variants.length > 1) ? variants : [];
  const sibsHtml = sibs.length ? `
    <div class="modal-variants">
      <div class="mv-title">其他版本（同卡，加工不同）</div>
      <div class="mv-list">${sibs.map((v) => `
        <div class="mv-item${v.id === card.id ? " current" : ""}" data-mv="${v.id}" title="${escapeAttr(v.rarity || "?")}">
          <img loading="lazy" src="${v.image}" alt="">
          <span class="mv-rarity">${v.rarity || "?"}</span>
          <span class="mv-owned">${state.collection[v.id] || 0}</span>
        </div>`).join("")}</div>
    </div>` : "";
  body.innerHTML = `
    <img src="${card.image}" alt="${escapeAttr(card.name)}">
    <h2>${escapeText(card.name)} <small style="color:var(--text-dim)">${card.id}</small></h2>
    <p>
      ${TYPE_LABEL[card.type] || card.type}
      ${card.support_subtype ? "・" + card.support_subtype : ""}
      ${card.rarity ? " ・ " + card.rarity : ""}<br>
      色: ${(card.color || []).map((c) => COLOR_LABEL[c]).join(" / ") || "—"}<br>
      ${card.hp ? "HP: " + card.hp + "<br>" : ""}
      ${card.life ? "LIFE: " + card.life + "<br>" : ""}
      ${card.bloom_level ? "Bloom: " + card.bloom_level + "<br>" : ""}
      ${card.baton_pass?.length ? "バトンタッチ: " + card.baton_pass.map((c) => COLOR_LABEL[c]).join("") + "<br>" : ""}
      ${card.tags?.length ? "タグ: " + card.tags.join(" ") + "<br>" : ""}
    </p>
    ${card.ability_text ? `<div class="skill"><div>${escapeText(card.ability_text)}</div></div>` : ""}
    ${skillsHtml}
    ${sibsHtml}
    ${(() => {
      const ts = talentsOf(card);
      return ts.length
        ? `<div class="talent-tag" style="clear:left"><span class="tt-label">藝人</span>${ts.map((t) => `<span class="talent-pill" data-talent="${escapeAttr(t)}">${escapeText(talentLabel(t))}</span>`).join("")}</div>`
        : "";
    })()}
    <p style="font-size:11px;color:var(--text-dim);clear:left">
      ${card.illustrator ? "イラスト: " + escapeText(card.illustrator) : ""}<br>
      持有(此版本): ${state.collection[card.id] || 0}${sibs.length ? " ・ 此卡合計: " + ownedOfNumber(card.card_number || card.id) : ""}
    </p>`;
  // Click a sibling printing to switch the modal to it
  body.querySelectorAll(".mv-item").forEach((el) => {
    el.addEventListener("click", () => showCardModal(state.cards[el.dataset.mv], sibs));
  });
  // Click a talent pill to filter the collection by that talent
  body.querySelectorAll(".talent-pill").forEach((el) => {
    el.addEventListener("click", () => {
      state.filters.talent = el.dataset.talent;
      const inp = document.getElementById("f-talent");
      if (inp) inp.value = el.dataset.talent;
      LS.save();
      document.getElementById("card-modal").close();
      switchTab("collection");
      renderCollection();
    });
  });
  const dlg = document.getElementById("card-modal");
  if (!dlg.open) dlg.showModal(); // re-rendering while open (sibling) must not re-open
}

// ============== UTILS ==============
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function uniq(arr) { return [...new Set(arr)]; }
function sumCounts(o) { return Object.values(o).reduce((a, b) => a + b, 0); }
function escapeText(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, "&quot;");
}

// ponytail: self-test for the hamming math the matcher depends on
function _selftest() {
  console.assert(popcount(0) === 0);
  console.assert(popcount(0xffffffff >>> 0) === 32);
  console.assert(popcount(0b1011) === 3);
  // identical hashes -> distance 0
  console.assert(hammingHex("0000000000000000", { hi: 0, lo: 0 }) === 0);
  // every bit different -> 64
  console.assert(hammingHex("ffffffffffffffff", { hi: 0, lo: 0 }) === 64);
  // one nibble (4 bits) different in the low word
  console.assert(hammingHex("000000000000000f", { hi: 0, lo: 0 }) === 4);
  console.log("selftest: hamming OK");
}
if (location.hash === "#selftest") _selftest();
