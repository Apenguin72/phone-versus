import {
  createTournament,
  currentMatch,
  drawEntrants,
  isRestorable,
  pickWinner,
  podium,
  progress,
  sizeOptions,
  undo,
} from "./bracket.js";

const STORAGE_KEY = "phone-versus-tournament-v1";
const PICK_LOCK_MS = 450;

const BRANDS = [
  ["", "全部品牌"],
  ["Apple", "Apple（蘋果）"],
  ["Samsung", "Samsung（三星）"],
  ["Google", "Google"],
  ["Xiaomi", "Xiaomi（小米）"],
  ["Huawei", "Huawei（華為）"],
  ["OPPO", "OPPO"],
];

const BRAND_ORDER = BRANDS.slice(1).map(([brand]) => brand);

const SOURCE_LABEL = {
  official: "官方",
  gsmarena: "GSMArena",
  regulatory: "法規文件",
};

const BATTERY_SOURCE_LABEL = {
  filing: "申報",
  press: "報導",
};

const picker = {
  a: { brand: "", query: "", slug: "" },
  b: { brand: "", query: "", slug: "" },
};

let phones = [];
let bySlug = new Map();
let tournament = null;
let preview = { size: 16, entrants: [] };
let poolLimit = null;
let pickLock = false;
let compareReady = false;

const els = {};

init();

async function init() {
  Object.assign(els, {
    loading: document.getElementById("loading"),
    error: document.getElementById("error"),
    app: document.getElementById("app"),
    empty: document.getElementById("empty"),
    start: document.getElementById("view-start"),
    play: document.getElementById("view-play"),
    compare: document.getElementById("view-compare"),
    workspace: document.getElementById("workspace"),
    filterEmpty: document.getElementById("filter-empty"),
    same: document.getElementById("same"),
    compareWrap: document.getElementById("compare-wrap"),
    coreOnly: document.getElementById("core-only"),
    scopeCount: document.getElementById("scope-count"),
    tbody: document.querySelector("#compare tbody"),
    headA: document.getElementById("head-a"),
    headB: document.getElementById("head-b"),
  });

  try {
    const response = await fetch("data/phones.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("資料格式不是陣列");
    phones = sortPhones(data);
    bySlug = new Map(phones.map((phone) => [slugOf(phone), phone]));
  } catch (err) {
    showError("手機資料無法讀取。請確認 data/phones.json 可以從這個網站載入。");
    return;
  }

  els.loading.hidden = true;
  els.app.hidden = false;
  if (!phones.length) {
    els.start.hidden = true;
    els.play.hidden = true;
    els.compare.hidden = true;
    els.empty.hidden = false;
    return;
  }

  setupCompare();
  setupTournament();
  window.addEventListener("popstate", () => renderRoute());
  if (!history.state) {
    const view = viewFromLocation();
    history.replaceState({ view }, "", hashFor(view));
  }
  restoreTournament();
  if (viewFromLocation() === "play" && !tournament) {
    history.replaceState({ view: "start" }, "", "#/");
  }
  ensurePreview();
  renderRoute();
}

function showError(message) {
  els.loading.hidden = true;
  els.error.hidden = false;
  els.error.textContent = message;
}

function setupCompare() {
  fillBrandSelect(document.getElementById("brand-a"));
  fillBrandSelect(document.getElementById("brand-b"));
  bindPicker("a");
  bindPicker("b");
  els.coreOnly.addEventListener("change", () => refresh());
  chooseDefaults();
  refresh();
  compareReady = true;
}

function setupTournament() {
  document.getElementById("tab-play").addEventListener("click", () => {
    navigate(tournament ? "play" : "start");
  });
  document.getElementById("tab-compare").addEventListener("click", () => navigate("compare"));
  document.getElementById("reshuffle").addEventListener("click", () => reshuffle());
  document.getElementById("start-game").addEventListener("click", () => startGame());
  document.getElementById("continue-game").addEventListener("click", () => navigate("play"));
  document.getElementById("undo").addEventListener("click", () => {
    if (!tournament) return;
    tournament = undo(tournament);
    saveTournament();
    renderPlay();
  });
}

function viewFromLocation() {
  const hash = location.hash || "#/";
  if (hash.startsWith("#/compare")) return "compare";
  if (hash.startsWith("#/play")) return "play";
  return "start";
}

function hashFor(view) {
  if (view === "compare") return "#/compare";
  if (view === "play") return "#/play";
  return "#/";
}

function navigate(view) {
  const hash = hashFor(view);
  if ((location.hash || "#/") === hash && history.state?.view === view) {
    renderRoute();
    return;
  }
  history.pushState({ view }, "", hash);
  renderRoute();
}

function renderRoute() {
  const view = history.state?.view || viewFromLocation();
  els.start.hidden = view !== "start";
  els.play.hidden = view !== "play";
  els.compare.hidden = view !== "compare";
  document.getElementById("tab-play").setAttribute("aria-current", view === "compare" ? "false" : "page");
  document.getElementById("tab-compare").setAttribute("aria-current", view === "compare" ? "page" : "false");
  if (view === "start") renderStart();
  if (view === "play") renderPlay();
}

function coreSlugList() {
  const slugs = phones.filter((phone) => phone.core === true).map(slugOf);
  const limited = poolLimit == null ? slugs : slugs.slice(0, poolLimit);
  return limited;
}

function ensurePreview() {
  const pool = coreSlugList();
  const options = sizeOptions(pool.length);
  const current = options.find((item) => item.size === preview.size && item.enabled);
  const fallback = options.find((item) => item.enabled);
  preview.size = (current || fallback)?.size || 16;
  if (!current && !fallback) {
    preview.entrants = [];
    return;
  }
  if (preview.entrants.length !== preview.size) reshuffle();
}

function reshuffle() {
  const pool = coreSlugList();
  const option = sizeOptions(pool.length).find((item) => item.size === preview.size);
  if (!option?.enabled) {
    preview.entrants = [];
    renderStart();
    return;
  }
  preview.entrants = drawEntrants(pool, preview.size, cryptoRandom);
  renderStart();
}

function startGame() {
  const pool = coreSlugList();
  const option = sizeOptions(pool.length).find((item) => item.size === preview.size);
  if (!option?.enabled || preview.entrants.length !== preview.size) return;
  tournament = createTournament(preview.entrants);
  pickLock = false;
  saveTournament();
  navigate("play");
}

function renderStart() {
  const pool = coreSlugList();
  const options = sizeOptions(pool.length);
  const pickerEl = document.getElementById("size-picker");
  pickerEl.replaceChildren();
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "size-button";
    button.dataset.size = String(option.size);
    button.textContent = `${option.size} 強`;
    button.setAttribute("aria-pressed", option.size === preview.size ? "true" : "false");
    button.disabled = !option.enabled;
    if (!option.enabled) button.title = option.message;
    button.addEventListener("click", () => {
      if (!option.enabled) return;
      preview.size = option.size;
      preview.entrants = [];
      reshuffle();
    });
    pickerEl.append(button);
  }
  const warn = document.getElementById("size-warn");
  const blocked = options.filter((option) => !option.enabled);
  warn.hidden = blocked.length === 0;
  warn.textContent = blocked.map((option) => option.message).join(" ");
  const canStart = preview.entrants.length === preview.size && options.some((option) => option.size === preview.size && option.enabled);
  document.getElementById("start-game").disabled = !canStart;
  document.getElementById("reshuffle").disabled = !canStart;
  const list = document.getElementById("draw-list");
  list.replaceChildren();
  for (const slug of preview.entrants) {
    const phone = bySlug.get(slug);
    const item = document.createElement("li");
    item.textContent = phone ? `${phone.brand} ${phone.model}` : slug;
    list.append(item);
  }
  const continueRow = document.getElementById("continue-row");
  continueRow.hidden = !tournament;
  document.getElementById("continue-game").textContent = tournament?.phase === "done" ? "查看結果" : "繼續比賽";
  document.getElementById("replace-note").hidden = !(tournament && tournament.phase !== "done");
}

function renderPlay() {
  const undoButton = document.getElementById("undo");
  const board = document.getElementById("match-board");
  const podiumEl = document.getElementById("podium");
  const roundTitle = document.getElementById("round-name");
  const progressEl = document.getElementById("progress");
  if (!tournament) {
    roundTitle.textContent = "沒有進行中的比賽";
    progressEl.textContent = "";
    board.replaceChildren();
    podiumEl.hidden = true;
    undoButton.disabled = true;
    return;
  }
  undoButton.disabled = tournament.history.length === 0;
  if (tournament.phase === "done") {
    roundTitle.textContent = "最終名次";
    progressEl.textContent = "冠軍、亞軍與季軍";
    board.hidden = true;
    board.replaceChildren();
    renderPodium(podiumEl);
    podiumEl.hidden = false;
    return;
  }
  board.hidden = false;
  podiumEl.hidden = true;
  podiumEl.replaceChildren();
  const info = progress(tournament);
  roundTitle.textContent = info.roundName;
  progressEl.textContent = `第 ${info.index} 場，共 ${info.total} 場`;
  const match = currentMatch(tournament);
  board.replaceChildren();
  board.classList.toggle("is-locked", pickLock);
  if (!match?.a || !match?.b || match.a === match.b) {
    const problem = document.createElement("p");
    problem.className = "empty";
    problem.textContent = "這一場的對戰資料不完整。";
    board.append(problem);
    return;
  }
  board.append(renderCard(bySlug.get(match.a), "a"), renderCard(bySlug.get(match.b), "b"));
}

function renderCard(phone, side) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "match-card";
  button.dataset.side = side;
  if (!phone) {
    button.disabled = true;
    button.textContent = "找不到這支手機";
    return button;
  }
  const name = `${phone.brand} ${phone.model}`;
  button.dataset.slug = slugOf(phone);
  button.setAttribute("aria-label", `選擇 ${name}`);
  button.append(renderPhoto(phone));
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = name;
  button.append(title, renderSpecList(phone));
  button.addEventListener("click", () => onPick(slugOf(phone)));
  return button;
}

function onPick(slug) {
  if (pickLock || !tournament || tournament.phase === "done") return;
  const match = currentMatch(tournament);
  if (!match || match.winner || (slug !== match.a && slug !== match.b)) return;
  pickLock = true;
  document.getElementById("match-board")?.classList.add("is-locked");
  const next = pickWinner(tournament, slug);
  if (next === tournament) {
    pickLock = false;
    document.getElementById("match-board")?.classList.remove("is-locked");
    return;
  }
  tournament = next;
  saveTournament();
  renderPlay();
  window.setTimeout(() => {
    pickLock = false;
    document.getElementById("match-board")?.classList.remove("is-locked");
  }, PICK_LOCK_MS);
}

function renderPodium(container) {
  const places = podium(tournament);
  container.replaceChildren();
  const list = document.createElement("ol");
  list.className = "podium-list";
  list.append(
    renderPlace(1, "冠軍", places?.champion),
    renderPlace(2, "亞軍", places?.runnerUp),
    renderPlace(3, "季軍", places?.third),
  );
  const again = document.createElement("button");
  again.type = "button";
  again.className = "primary";
  again.id = "play-again";
  again.textContent = "再玩一次";
  again.addEventListener("click", () => {
    preview.entrants = [];
    ensurePreview();
    navigate("start");
  });
  container.append(list, again);
}

function renderPlace(place, label, slug) {
  const item = document.createElement("li");
  item.className = `place place-${place}`;
  item.dataset.place = String(place);
  if (slug) item.dataset.slug = slug;
  const rank = document.createElement("p");
  rank.className = "rank";
  rank.textContent = String(place);
  const heading = document.createElement("h3");
  heading.textContent = label;
  item.append(rank);
  const phone = slug ? bySlug.get(slug) : null;
  if (!phone) {
    item.append(heading);
    return item;
  }
  const name = document.createElement("p");
  name.className = "card-title";
  name.textContent = `${phone.brand} ${phone.model}`;
  item.append(renderPhoto(phone), heading, name);
  return item;
}

function renderPhoto(phone) {
  const frame = document.createElement("div");
  frame.className = "photo";
  const showPlaceholder = () => {
    frame.dataset.photo = "placeholder";
    frame.replaceChildren();
    const brand = document.createElement("p");
    brand.className = "photo-brand";
    brand.textContent = phone.brand;
    const model = document.createElement("p");
    model.className = "photo-model";
    model.textContent = phone.model;
    frame.append(brand, model);
    appendImageCredit(frame, phone);
  };
  if (!isRemoteImage(phone.image_url)) {
    showPlaceholder();
    return frame;
  }
  frame.dataset.photo = "remote";
  const image = document.createElement("img");
  image.alt = `${phone.brand} ${phone.model}`;
  image.referrerPolicy = "no-referrer";
  image.loading = "lazy";
  image.addEventListener("error", showPlaceholder, { once: true });
  image.src = phone.image_url;
  frame.append(image);
  appendImageCredit(frame, phone);
  return frame;
}

function appendImageCredit(frame, phone) {
  const parts = [phone.image_note, phone.image_source].filter((value) => hasText(value));
  if (!parts.length) return;
  const credit = document.createElement("p");
  credit.className = "photo-credit";
  credit.textContent = parts.map((value) => value.trim()).join(" · ");
  frame.append(credit);
}

function isRemoteImage(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function renderSpecList(phone) {
  const list = document.createElement("dl");
  list.className = "spec-list";
  addSpec(list, "晶片", chipSpec(phone));
  addSpec(list, "電池", batterySpec(phone));
  addSpec(list, "重量", valueLine(phone, "weight_g", formatWeight));
  addSpec(list, "螢幕", screenCell(phone));
  addSpec(list, "刷新率", refreshCell(phone));
  addSpec(list, "系統", valueLine(phone, "os_at_launch", (value) => value));
  return list;
}

function addSpec(list, label, node) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.append(node);
  row.append(term, detail);
  list.append(row);
}

function chipSpec(phone) {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  wrap.append(valueLine(phone, "chip", (value) => value));
  const variants = variantLines(phone.chip_variants);
  if (!variants.length) return wrap;
  const note = document.createElement("div");
  note.className = "subnote";
  for (const variant of variants) {
    const line = document.createElement("span");
    line.className = "variant";
    line.textContent = variant;
    note.append(line);
  }
  wrap.append(note);
  return wrap;
}

function batterySpec(phone) {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  const line = valueLine(phone, "battery_mAh", (value) => `${formatNumber(value)} mAh`);
  if (BATTERY_SOURCE_LABEL[phone.battery_source_type]) {
    const source = document.createElement("span");
    source.className = "subnote";
    source.textContent = BATTERY_SOURCE_LABEL[phone.battery_source_type];
    line.append(source);
  }
  wrap.append(line);
  if (phone.official_endurance_hours != null) {
    const hours = document.createElement("p");
    hours.className = "endurance";
    hours.textContent = `官方續航 ${formatNumber(phone.official_endurance_hours)} 小時（僅供參考）`;
    wrap.append(hours);
  }
  return wrap;
}

function saveTournament() {
  if (!tournament) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tournament));
}

function restoreTournament() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!isRestorable(saved, new Set(bySlug.keys()))) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    tournament = saved;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function cryptoRandom() {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 4294967296;
}

function bindPicker(side) {
  const brand = document.getElementById(`brand-${side}`);
  const search = document.getElementById(`search-${side}`);
  const phone = document.getElementById(`phone-${side}`);
  brand.addEventListener("change", () => {
    picker[side].brand = brand.value;
    refresh();
  });
  search.addEventListener("input", () => {
    picker[side].query = search.value;
    refresh();
  });
  phone.addEventListener("change", () => {
    picker[side].slug = phone.value;
    renderCompare();
  });
}

function fillBrandSelect(select) {
  select.replaceChildren();
  for (const [value, label] of BRANDS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function chooseDefaults() {
  const list = phones.filter((phone) => phone.core);
  if (!list.length) return;
  picker.a.slug = slugOf(list[0]);
  const other = list.find((phone) => phone.brand !== list[0].brand) || list[1] || list[0];
  picker.b.slug = slugOf(other);
}

function refresh() {
  if (!compareReady && !els.coreOnly) return;
  const listA = visiblePhones("a");
  const listB = visiblePhones("b");
  picker.a.slug = fillPhoneSelect("a", listA);
  picker.b.slug = fillPhoneSelect("b", listB);
  const coreCount = phones.filter((phone) => phone.core).length;
  els.scopeCount.textContent = `主力機型 ${coreCount} 支 · 全部 ${phones.length} 支`;
  document.getElementById("count-a").textContent = `${listA.length} 支`;
  document.getElementById("count-b").textContent = `${listB.length} 支`;
  renderCompare();
}

function visiblePhones(side) {
  const coreOnly = els.coreOnly.checked;
  const brand = picker[side].brand;
  const query = normalize(picker[side].query);
  return phones.filter((phone) => {
    if (coreOnly && !phone.core) return false;
    if (brand && phone.brand !== brand) return false;
    if (query && !normalize(`${phone.brand} ${phone.model}`).includes(query)) return false;
    return true;
  });
}

function fillPhoneSelect(side, list) {
  const select = document.getElementById(`phone-${side}`);
  select.replaceChildren();
  if (!list.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "沒有符合的手機";
    select.append(option);
    select.disabled = true;
    return "";
  }
  select.disabled = false;
  for (const phone of list) {
    const option = document.createElement("option");
    option.value = slugOf(phone);
    const suffix = phone.core ? "" : "（非主力）";
    option.textContent = `${phone.brand} ${phone.model}${suffix}`;
    select.append(option);
  }
  const preferred = preferredSlug(side, list);
  select.value = preferred;
  return preferred;
}

function preferredSlug(side, list) {
  const slugs = list.map(slugOf);
  if (slugs.includes(picker[side].slug)) return picker[side].slug;
  if (side === "b") {
    const other = list.find((phone) => slugOf(phone) !== picker.a.slug);
    if (other) return slugOf(other);
  }
  return slugs[0];
}

function renderCompare() {
  const left = bySlug.get(picker.a.slug);
  const right = bySlug.get(picker.b.slug);
  const ready = Boolean(left && right);
  els.filterEmpty.hidden = ready;
  els.compareWrap.hidden = !ready;
  els.same.hidden = !ready || slugOf(left) !== slugOf(right);
  if (!ready) {
    els.tbody.replaceChildren();
    els.headA.replaceChildren();
    els.headB.replaceChildren();
    return;
  }

  els.headA.replaceChildren(headerCell(left));
  els.headB.replaceChildren(headerCell(right));
  els.tbody.replaceChildren();
  addRow("chip", "晶片", left, right, chipCell);
  addRow("battery_mAh", "電池容量", left, right, batteryCell, "high");
  addRow("weight_g", "重量", left, right, (phone) => valueLine(phone, "weight_g", formatWeight), "low");
  addRow("screen", "螢幕", left, right, screenCell);
  addRow("refresh_hz", "刷新率", left, right, refreshCell, "high");
  addRow("os_at_launch", "作業系統", left, right, (phone) => valueLine(phone, "os_at_launch", (value) => value));
  addRow("source", "來源", left, right, sourceCell);
  if (hasText(left.notes) || hasText(right.notes)) {
    addRow("notes", "備註", left, right, notesCell);
  }
}

function addRow(field, label, left, right, buildCell, better) {
  const row = document.createElement("tr");
  row.dataset.field = field;
  const heading = document.createElement("th");
  heading.scope = "row";
  heading.textContent = label;
  if (better && blocksWinner(left, right, field)) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "未確認，略過優劣";
    heading.append(hint);
  }
  const cellA = document.createElement("td");
  const cellB = document.createElement("td");
  cellA.dataset.side = "a";
  cellB.dataset.side = "b";
  cellA.append(buildCell(left));
  cellB.append(buildCell(right));
  if (better) {
    const win = winner(left, right, field, better);
    const cell = win === "a" ? cellA : win === "b" ? cellB : null;
    if (cell) {
      cell.classList.add("win");
      const line = cell.querySelector(".value-line");
      if (line) line.prepend(badge("較優", "win"));
      else cell.prepend(badge("較優", "win"));
    }
  }
  row.append(heading, cellA, cellB);
  els.tbody.append(row);
}

function headerCell(phone) {
  const wrap = document.createElement("div");
  const name = document.createElement("div");
  name.className = "phone-name";
  name.textContent = `${phone.brand} ${phone.model}`;
  const meta = document.createElement("div");
  meta.className = "phone-meta";
  meta.textContent = `${phone.announce_date} 發表`;
  wrap.append(name, meta);
  if (!phone.core) wrap.append(badge("非主力", "muted"));
  return wrap;
}

function chipCell(phone) {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  wrap.append(valueLine(phone, "chip", (value) => value));
  const variants = variantLines(phone.chip_variants);
  if (!variants.length) return wrap;
  const note = document.createElement("div");
  note.className = "subnote";
  const label = document.createElement("span");
  label.className = "subnote-label";
  label.textContent = "地區版本";
  note.append(label);
  for (const variant of variants) {
    const line = document.createElement("span");
    line.className = "variant";
    line.textContent = variant;
    note.append(line);
  }
  wrap.append(note);
  return wrap;
}

function batteryCell(phone) {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  const line = valueLine(phone, "battery_mAh", (value) => `${formatNumber(value)} mAh`);
  const source = batterySourceLink(phone);
  if (source) line.append(source);
  wrap.append(line);
  if (phone.official_endurance_hours != null) {
    const hours = document.createElement("p");
    hours.className = "endurance";
    hours.textContent = `官方續航 ${formatNumber(phone.official_endurance_hours)} 小時（僅供參考）`;
    wrap.append(hours);
  }
  return wrap;
}

function refreshCell(phone) {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  wrap.append(valueLine(phone, "refresh_hz", (value) => `${formatNumber(value)} Hz`));
  if (hasText(phone.refresh_note)) {
    const note = document.createElement("p");
    note.className = "subnote";
    note.textContent = phone.refresh_note.trim();
    wrap.append(note);
  }
  return wrap;
}

function batterySourceLink(phone) {
  const url = phone.battery_source_url;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  const link = document.createElement("a");
  link.className = "battery-source";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = BATTERY_SOURCE_LABEL[phone.battery_source_type] || "電池來源";
  return link;
}

function variantLines(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

function screenCell(phone) {
  const line = document.createElement("div");
  line.className = "value-line";
  line.append(valueLine(phone, "screen_inch", formatInch));
  line.append(document.createTextNode("·"));
  line.append(valueLine(phone, "resolution", formatResolution));
  return line;
}

function sourceCell(phone) {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  const line = document.createElement("div");
  line.className = "value-line";
  const kind = document.createElement("span");
  kind.className = "source-type";
  kind.textContent = SOURCE_LABEL[phone.source_type] || phone.source_type || "來源";
  line.append(kind);
  if (typeof phone.source_url === "string" && /^https?:\/\//i.test(phone.source_url)) {
    const link = document.createElement("a");
    link.href = phone.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "規格來源";
    line.append(link);
  }
  wrap.append(line);
  if (phone.checked_date) {
    const checked = document.createElement("p");
    checked.className = "endurance";
    checked.textContent = `查核 ${phone.checked_date}`;
    wrap.append(checked);
  }
  return wrap;
}

function notesCell(phone) {
  const paragraph = document.createElement("p");
  paragraph.className = "notes";
  if (!hasText(phone.notes)) {
    paragraph.textContent = "—";
    return paragraph;
  }
  appendLinkedText(paragraph, phone.notes.trim());
  return paragraph;
}

function valueLine(phone, field, format) {
  const line = document.createElement("span");
  line.className = "value-line";
  const status = fieldStatus(phone, field);
  const value = phone[field];
  if (value == null) {
    const unknown = document.createElement("span");
    unknown.className = "unknown";
    unknown.textContent = status === "unconfirmed" ? "未確認" : "—";
    line.append(unknown);
    return line;
  }
  line.append(document.createTextNode(format(value)));
  if (status === "inferred") line.append(badge("推定", "inferred"));
  if (status === "unconfirmed") line.append(badge("未確認", "unconfirmed"));
  return line;
}

function badge(text, kind) {
  const span = document.createElement("span");
  span.className = `badge badge-${kind}`;
  span.textContent = text;
  return span;
}

function winner(left, right, field, better) {
  if (blocksWinner(left, right, field)) return null;
  const a = left[field];
  const b = right[field];
  if (a == null || b == null || a === b) return null;
  const leftWins = better === "high" ? a > b : a < b;
  return leftWins ? "a" : "b";
}

function blocksWinner(left, right, field) {
  return fieldStatus(left, field) === "unconfirmed" || fieldStatus(right, field) === "unconfirmed";
}

function fieldStatus(phone, field) {
  return phone.field_status?.[field] || "confirmed";
}

function sortPhones(list) {
  const rank = new Map(BRAND_ORDER.map((brand, index) => [brand, index]));
  return list.slice().sort((a, b) => {
    const brandDiff = (rank.get(a.brand) ?? 99) - (rank.get(b.brand) ?? 99);
    if (brandDiff) return brandDiff;
    if (a.announce_date !== b.announce_date) return b.announce_date.localeCompare(a.announce_date);
    return a.model.localeCompare(b.model, "en");
  });
}

function slugOf(phone) {
  return `${phone.brand} ${phone.model}`
    .toLowerCase()
    .replace(/[+＋]/g, " plus ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalize(value) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/＋/g, "+");
}

function formatNumber(value) {
  return Number(value).toLocaleString("zh-Hant");
}

function formatWeight(value) {
  const tenths = Math.round(Number(value) * 10) / 10;
  const text = Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
  return `${text} g`;
}

function formatInch(value) {
  const hundredths = Math.round(Number(value) * 100) / 100;
  return `${hundredths} 吋`;
}

function formatResolution(value) {
  return String(value).replace(/x/gi, "×");
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function appendLinkedText(parent, text) {
  const matcher = /https?:\/\/[^\s]+/g;
  let last = 0;
  for (const match of text.matchAll(matcher)) {
    const start = match.index ?? 0;
    if (start > last) parent.append(document.createTextNode(text.slice(last, start)));
    const raw = match[0];
    const url = raw.replace(/[),.;，。、]+$/, "");
    const trailing = raw.slice(url.length);
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = url;
    parent.append(link);
    if (trailing) parent.append(document.createTextNode(trailing));
    last = start + raw.length;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

globalThis.__phoneVersus = {
  get tournament() {
    return tournament;
  },
  get preview() {
    return preview;
  },
  get phonesBySlug() {
    return bySlug;
  },
  slugOf,
  setPoolLimit(limit) {
    poolLimit = limit;
    preview.entrants = [];
    ensurePreview();
    renderStart();
  },
  clearPoolLimit() {
    poolLimit = null;
    preview.entrants = [];
    ensurePreview();
    renderStart();
  },
  renderPlay,
};
