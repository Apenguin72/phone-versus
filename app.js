import {
  createTournament,
  currentMatch,
  drawEntrants,
  gameRecord,
  isRestorable,
  pickWinner,
  podium,
  progress,
  sizeOptions,
  undo,
} from "./bracket.js";

const STORAGE_KEY = "phone-versus-tournament-v1";
const VISITOR_KEY = "phone-versus-visitor-id";
const PICK_LOCK_MS = 450;
const SUPABASE_URL = "https://dwlgryypcxgaejkislxx.supabase.co";
const SUPABASE_KEY = "sb_publishable_Q13zZthAOCxUuG2pSptGfg_iAOGH1Li";

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

const BRAND_ACCENT = {
  Apple: "#8e8e93",
  Samsung: "#5b7cfa",
  Google: "#4285f4",
  Xiaomi: "#ff6900",
  Huawei: "#cf0a2c",
  OPPO: "#26c281",
};

const picker = {
  a: { brand: "", query: "", slug: "" },
  b: { brand: "", query: "", slug: "" },
};

let phones = [];
let bySlug = new Map();
let chipScores = {};
let spec26Max = 0;
let cameras = new Map();
let prices = new Map();
let tournament = null;
let preview = { size: 16, entrants: [] };
let poolLimit = null;
let pickLock = false;
let compareReady = false;

const els = {};

init();

async function init() {
  recordVisit();
  Object.assign(els, {
    loading: document.getElementById("loading"),
    error: document.getElementById("error"),
    app: document.getElementById("app"),
    empty: document.getElementById("empty"),
    start: document.getElementById("view-start"),
    play: document.getElementById("view-play"),
    compare: document.getElementById("view-compare"),
    ranking: document.getElementById("view-ranking"),
    filterEmpty: document.getElementById("filter-empty"),
    same: document.getElementById("same"),
    compareBoard: document.getElementById("compare-board"),
    coreOnly: document.getElementById("core-only"),
    scopeCount: document.getElementById("scope-count"),
    rankStatus: document.getElementById("rank-status"),
    rankTop: document.getElementById("rank-top"),
    rankList: document.getElementById("rank-list"),
  });

  try {
    const [phoneResponse, chipResponse, cameraResponse, priceResponse] = await Promise.all([
      fetch("data/phones.json"),
      fetch("data/chip_scores.json").catch(() => null),
      fetch("data/camera_specs.json").catch(() => null),
      fetch("data/launch_prices.json").catch(() => null),
    ]);
    if (!phoneResponse.ok) throw new Error(`HTTP ${phoneResponse.status}`);
    const data = await phoneResponse.json();
    if (!Array.isArray(data)) throw new Error("資料格式不是陣列");
    phones = sortPhones(data);
    bySlug = new Map(phones.map((phone) => [slugOf(phone), phone]));
    const chipData = await readOptionalJson(chipResponse);
    if (chipData && typeof chipData === "object" && !Array.isArray(chipData)) chipScores = chipData;
    const cameraRows = await readOptionalJson(cameraResponse);
    if (Array.isArray(cameraRows)) cameras = cameraMap(cameraRows);
    const priceRows = await readOptionalJson(priceResponse);
    if (Array.isArray(priceRows)) prices = priceMap(priceRows);
    recomputeSpec26Max();
  } catch {
    showError("手機資料無法讀取。請確認 data/phones.json 可以從這個網站載入。");
    return;
  }

  els.loading.hidden = true;
  els.app.hidden = false;
  if (!phones.length) {
    els.start.hidden = true;
    els.play.hidden = true;
    els.compare.hidden = true;
    els.ranking.hidden = true;
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
  if (tournament?.phase === "done") maybeSubmit();
}

async function readOptionalJson(response) {
  if (!response?.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function cameraMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") continue;
    map.set(`${row[0]}|${row[1]}`, {
      main: row[2],
      rear: row[3],
      front: row[4],
    });
  }
  return map;
}

function priceMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") continue;
    map.set(`${row[0]}|${row[1]}`, {
      price: row[2],
      converted: row[3] === 1,
    });
  }
  return map;
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
  document.getElementById("tab-ranking").addEventListener("click", () => navigate("ranking"));
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
  if (hash.startsWith("#/ranking")) return "ranking";
  return "start";
}

function hashFor(view) {
  if (view === "compare") return "#/compare";
  if (view === "play") return "#/play";
  if (view === "ranking") return "#/ranking";
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
  document.body.dataset.route = view;
  els.start.hidden = view !== "start";
  els.play.hidden = view !== "play";
  els.compare.hidden = view !== "compare";
  els.ranking.hidden = view !== "ranking";
  const current = {
    "tab-play": view === "start" || view === "play",
    "tab-compare": view === "compare",
    "tab-ranking": view === "ranking",
  };
  for (const [id, on] of Object.entries(current)) {
    document.getElementById(id).setAttribute("aria-current", on ? "page" : "false");
  }
  if (view === "start") renderStart();
  if (view === "play") renderPlay();
  if (view === "ranking") loadRankings();
}

function coreSlugList() {
  const slugs = phones.filter((phone) => phone.core === true).map(slugOf);
  return poolLimit == null ? slugs : slugs.slice(0, poolLimit);
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
    maybeSubmit();
    return;
  }
  board.hidden = false;
  podiumEl.hidden = true;
  podiumEl.replaceChildren();
  const info = progress(tournament);
  roundTitle.textContent = info.roundName;
  progressEl.textContent = `第 ${info.index} 場，共 ${info.total} 場`;
  const match = currentMatch(tournament);
  board.classList.toggle("is-locked", pickLock);
  if (!match?.a || !match?.b || match.a === match.b) {
    board.replaceChildren();
    const problem = document.createElement("p");
    problem.className = "empty";
    problem.textContent = "這一場的對戰資料不完整。";
    board.append(problem);
    return;
  }
  renderVersus(board, bySlug.get(match.a), bySlug.get(match.b), onPick);
  preloadPhoneImages(phonesForMatch(nextMatch(tournament)));
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

function renderVersus(container, left, right, onPickSide) {
  container.replaceChildren();
  if (!left || !right) {
    const problem = document.createElement("p");
    problem.className = "empty";
    problem.textContent = "找不到這支手機。";
    container.append(problem);
    return;
  }
  const head = document.createElement("div");
  head.className = "versus-head";
  const title = document.createElement("h2");
  title.textContent = `${left.model} vs ${right.model}`;
  const sub = document.createElement("p");
  sub.textContent = "規格比較";
  head.append(title, sub);
  const grid = document.createElement("div");
  grid.className = "versus-grid";
  grid.append(
    renderPhoneCard(left, "a", onPickSide),
    renderSpecColumn(left, right),
    renderPhoneCard(right, "b", onPickSide),
  );
  container.append(head, grid);
}

function renderPhoneCard(phone, side, onPickSide) {
  const card = document.createElement(onPickSide ? "button" : "div");
  if (onPickSide) card.type = "button";
  card.className = "phone-card";
  card.dataset.side = side;
  const accent = accentOf(phone);
  card.style.setProperty("--phone-accent", accent);
  const name = `${phone.brand} ${phone.model}`;
  if (onPickSide) {
    card.setAttribute("aria-label", `選擇 ${name}`);
    card.addEventListener("click", () => onPickSide(slugOf(phone)));
  }
  const brand = document.createElement("p");
  brand.className = "brand";
  brand.textContent = phone.brand;
  const model = document.createElement("p");
  model.className = "model";
  model.textContent = phone.model;
  card.append(brand, model, renderPhoto(phone, ""));
  return card;
}

function renderSpecColumn(left, right) {
  const column = document.createElement("div");
  column.className = "spec-rows";
  column.append(
    specRow("晶片單核 (6W)", "", buildChipSide(left, right, "a"), buildChipSide(right, left, "b")),
    specRow("相機", "主鏡頭", buildCameraSide(left, right, "a"), buildCameraSide(right, left, "b")),
    numberRow("電池", "容量", left, right, "battery_mAh", "mAh", false),
    numberRow("重量", "越輕越好", left, right, "weight_g", "g", true),
    numberRow("更新率", "最高", left, right, "refresh_hz", "Hz", false),
    specRow("價格", "首發價", buildPriceSide(left, right, "a"), buildPriceSide(right, left, "b")),
  );
  return column;
}

function specRow(label, sub, sideA, sideB) {
  const row = document.createElement("div");
  row.className = "spec-row";
  const mid = document.createElement("div");
  mid.className = "spec-mid";
  const strong = document.createElement("strong");
  strong.textContent = label;
  mid.append(strong);
  if (sub) {
    const small = document.createElement("small");
    small.textContent = sub;
    mid.append(small);
  }
  row.append(sideA, mid, sideB);
  return row;
}

function numberRow(label, sub, left, right, field, unit, invert) {
  return specRow(
    label,
    sub,
    metricSide(left, right, field, unit, invert, "a"),
    metricSide(right, left, field, unit, invert, "b"),
  );
}

function metricSide(phone, other, field, unit, invert, side) {
  const value = numericValue(phone, field);
  const otherValue = numericValue(other, field);
  const wrap = document.createElement("div");
  wrap.className = `side side-${side}`;
  const metric = document.createElement("p");
  metric.className = "metric";
  if (value == null) {
    metric.append(missingLabel());
  } else {
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = field === "weight_g" ? formatWeightNumber(value) : formatNumber(value);
    metric.append(num);
    if (unit) {
      const unitEl = document.createElement("span");
      unitEl.className = "unit";
      unitEl.textContent = unit;
      metric.append(unitEl);
    }
  }
  wrap.append(metric, barTrack(phone, barPercent(value, otherValue, invert)));
  return wrap;
}

function buildPriceSide(phone, other, side) {
  const price = priceOf(phone);
  const otherPrice = priceOf(other);
  const value = priceAmount(price);
  const otherValue = priceAmount(otherPrice);
  const wrap = document.createElement("div");
  wrap.className = `side side-${side}`;
  const metric = document.createElement("p");
  metric.className = "metric";
  if (value == null) {
    metric.append(missingLabel());
  } else {
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = `NT$${formatNumber(value)}`;
    metric.append(num);
    if (price.converted) {
      const note = document.createElement("span");
      note.className = "unit";
      note.textContent = "（換算）";
      metric.append(note);
    }
  }
  wrap.append(metric, barTrack(phone, barPercent(value, otherValue, true)));
  return wrap;
}

function barTrack(phone, percent) {
  const track = document.createElement("div");
  track.className = "track";
  track.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  fill.className = "fill";
  const width = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  fill.style.width = `${width}%`;
  fill.style.setProperty("--phone-accent", accentOf(phone));
  fill.style.background = accentOf(phone);
  track.append(fill);
  return track;
}

function missingLabel() {
  const span = document.createElement("span");
  span.className = "missing";
  span.textContent = "待補數據";
  return span;
}

function buildChipSide(phone, _other, side) {
  const score = chipScore(phone?.chip);
  const wrap = document.createElement("div");
  wrap.className = `side side-${side}`;
  const metric = document.createElement("p");
  metric.className = "metric";
  if (score == null) metric.append(missingLabel());
  else {
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = formatChipScore(score);
    metric.append(num);
    if (chipConfidence(phone?.chip) !== "measured") {
      const tag = document.createElement("span");
      tag.className = "unit";
      tag.textContent = "推定";
      metric.append(tag);
    }
  }
  wrap.append(metric, barTrack(phone, chipBarPercent(score)));
  if (typeof phone?.chip === "string" && phone.chip) {
    const detail = document.createElement("p");
    detail.className = "detail";
    detail.textContent = phone.chip;
    detail.title = phone.chip;
    wrap.append(detail);
  }
  return wrap;
}

function buildCameraSide(phone, other, side) {
  const cam = cameraOf(phone);
  const otherCam = cameraOf(other);
  const main = finiteNumber(cam?.main);
  const otherMain = finiteNumber(otherCam?.main);
  const wrap = document.createElement("div");
  wrap.className = `side side-${side}`;
  const metric = document.createElement("p");
  metric.className = "metric";
  if (main == null) metric.append(missingLabel());
  else {
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = formatNumber(main);
    const unit = document.createElement("span");
    unit.className = "unit";
    unit.textContent = "MP";
    metric.append(num, unit);
  }
  wrap.append(metric, barTrack(phone, barPercent(main, otherMain, false)));
  const rear = typeof cam?.rear === "string" && cam.rear.trim() ? cam.rear : "";
  const front = finiteNumber(cam?.front);
  if (rear || front != null) {
    const detail = document.createElement("p");
    detail.className = "detail";
    const parts = [];
    if (rear) {
      const rearEl = document.createElement("span");
      rearEl.className = "rear";
      rearEl.textContent = rear;
      detail.append(rearEl);
      parts.push(rear);
    }
    if (front != null) {
      const frontText = `前鏡頭 ${formatNumber(front)}MP`;
      const frontEl = document.createElement("span");
      frontEl.className = "front";
      frontEl.textContent = frontText;
      detail.append(frontEl);
      parts.push(frontText);
    }
    detail.title = parts.join(" · ");
    wrap.append(detail);
  }
  return wrap;
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
  const status = document.createElement("p");
  status.className = "footnote";
  status.id = "submit-status";
  if (tournament?.submitError) status.textContent = "尚未連線";
  else status.hidden = true;
  container.append(list, status, again);
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
  name.className = "model";
  name.textContent = `${phone.brand} ${phone.model}`;
  name.style.color = accentOf(phone);
  item.append(renderPhoto(phone, `${phone.brand} ${phone.model}`), heading, name);
  return item;
}

const warmedImages = new Set();

function renderPhoto(phone, alt) {
  const frame = document.createElement("div");
  frame.className = "photo";
  const showPlaceholder = () => {
    frame.replaceChildren();
    const brand = document.createElement("p");
    brand.className = "photo-brand";
    brand.textContent = phone.brand;
    const model = document.createElement("p");
    model.className = "photo-model";
    model.textContent = phone.model;
    frame.append(brand, model);
  };
  const image = document.createElement("img");
  image.alt = alt;
  image.width = 600;
  image.height = 600;
  image.decoding = "async";
  image.addEventListener("error", showPlaceholder, { once: true });
  image.src = photoSrc(phone);
  frame.append(image);
  return frame;
}

function photoSrc(phone) {
  return `images/phones/${slugOf(phone)}.webp`;
}

function nextMatch(state) {
  if (!state || state.phase !== "main") return null;
  const round = state.rounds[state.round];
  if (state.match + 1 < round.length) return round[state.match + 1];
  if (state.round + 1 < state.rounds.length) {
    const upcoming = state.rounds[state.round + 1][0];
    if (upcoming?.a && upcoming?.b) return upcoming;
    return null;
  }
  if (state.third?.a && state.third?.b) return state.third;
  return null;
}

function phonesForMatch(match) {
  if (!match?.a || !match?.b) return [];
  return [bySlug.get(match.a), bySlug.get(match.b)].filter(Boolean);
}

function preloadPhoneImages(phonesToWarm) {
  document.querySelectorAll("link[data-preload-phone]").forEach((node) => node.remove());
  for (const phone of phonesToWarm) {
    const url = photoSrc(phone);
    if (!warmedImages.has(url)) {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      warmedImages.add(url);
    }
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = url;
    link.dataset.preloadPhone = "true";
    document.head.append(link);
  }
}

function saveTournament() {
  if (!tournament) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const { submitting, submitError, ...stored } = tournament;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
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

function visitorId() {
  const current = localStorage.getItem(VISITOR_KEY);
  if (current && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current)) {
    return current;
  }
  const created = crypto.randomUUID();
  localStorage.setItem(VISITOR_KEY, created);
  return created;
}

function recordVisit() {
  try {
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return;
    if (new URLSearchParams(location.search).has("test")) return;
    fetch(`${SUPABASE_URL}/rest/v1/rpc/record_visit`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_visitor: visitorId() }),
    }).catch(() => {});
  } catch {
    // A failed visit count must not affect the page.
  }
}

function deviceKind() {
  return window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop";
}

async function maybeSubmit() {
  if (!tournament || tournament.phase !== "done" || tournament.submitted || tournament.submitting) return;
  const record = gameRecord(tournament);
  if (!record) return;
  tournament.submitting = true;
  tournament.submitted = true;
  saveTournament();
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_game`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p: {
          visitor_id: visitorId(),
          bracket_size: record.bracket_size,
          entrants: record.entrants,
          matches: record.matches,
          top1: record.top1,
          top2: record.top2,
          top3: record.top3,
          device: deviceKind(),
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    tournament.submitError = false;
  } catch {
    tournament.submitted = false;
    tournament.submitError = true;
    saveTournament();
    const status = document.getElementById("submit-status");
    if (status) {
      status.hidden = false;
      status.textContent = "尚未連線";
    }
  } finally {
    tournament.submitting = false;
  }
}

async function loadRankings() {
  els.rankStatus.hidden = false;
  els.rankStatus.textContent = "正在讀取排名…";
  els.rankTop.hidden = true;
  els.rankList.hidden = true;
  els.rankTop.replaceChildren();
  els.rankList.replaceChildren();
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_rankings`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("排名格式不正確");
    if (!rows.length) {
      els.rankStatus.textContent = "還沒有排名";
      return;
    }
    els.rankStatus.hidden = true;
    renderRankings(rows);
  } catch {
    els.rankStatus.hidden = false;
    els.rankStatus.textContent = "尚未連線";
  }
}

function renderRankings(rows) {
  const top = rows.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  els.rankTop.hidden = false;
  els.rankTop.replaceChildren();
  order.forEach((row) => {
    const place = top.indexOf(row) + 1;
    els.rankTop.append(renderRankCard(row, place));
  });
  els.rankList.hidden = false;
  els.rankList.replaceChildren();
  rows.forEach((row, index) => {
    els.rankList.append(renderRankItem(row, index + 1));
  });
}

function renderRankCard(row, place) {
  const phone = bySlug.get(row.phone);
  const card = document.createElement("article");
  card.className = `rank-card place-${place}`;
  const label = document.createElement("p");
  label.className = "place-label";
  label.textContent = place === 1 ? "第 1 名" : place === 2 ? "第 2 名" : "第 3 名";
  card.append(label);
  if (phone) card.append(renderPhoto(phone, `${phone.brand} ${phone.model}`));
  const brand = document.createElement("p");
  brand.className = "brand";
  brand.textContent = phone ? phone.brand : "";
  const model = document.createElement("p");
  model.className = "model";
  model.textContent = phone ? phone.model : row.phone;
  if (phone) model.style.color = accentOf(phone);
  const elo = document.createElement("p");
  elo.className = "elo";
  elo.textContent = formatElo(row.elo);
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${formatNumber(row.matches)} 場 · ${formatNumber(row.wins)} 勝`;
  card.append(brand, model, elo, meta);
  return card;
}

function renderRankItem(row, place) {
  const phone = bySlug.get(row.phone);
  const item = document.createElement("li");
  const num = document.createElement("span");
  num.className = "num";
  num.textContent = String(place);
  const image = document.createElement("img");
  image.alt = "";
  image.width = 46;
  image.height = 46;
  if (phone) image.src = photoSrc(phone);
  const name = document.createElement("span");
  name.className = "name";
  if (phone) {
    name.textContent = phone.model;
    const small = document.createElement("small");
    small.textContent = phone.brand;
    name.append(small);
  } else {
    name.textContent = row.phone;
  }
  const stats = document.createElement("span");
  stats.className = "stats";
  const elo = document.createElement("b");
  elo.textContent = formatElo(row.elo);
  const meta = document.createElement("span");
  meta.textContent = `${formatNumber(row.matches)} 場 · ${formatNumber(row.wins)} 勝`;
  stats.append(elo, meta);
  item.append(num, image, name, stats);
  return item;
}

function formatElo(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("zh-Hant", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
  els.scopeCount.textContent = `參賽機型 ${coreCount} 支 · 全部 ${phones.length} 支`;
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
    option.textContent = `${phone.brand} ${phone.model}`;
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
  els.compareBoard.hidden = !ready;
  els.same.hidden = !ready || slugOf(left) !== slugOf(right);
  if (!ready) {
    els.compareBoard.replaceChildren();
    return;
  }
  renderVersus(els.compareBoard, left, right, null);
}

function accentOf(phone) {
  if (phone && typeof phone.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(phone.accent)) return phone.accent;
  return BRAND_ACCENT[phone?.brand] || "#d6d3d1";
}

function cameraOf(phone) {
  if (!phone) return null;
  return cameras.get(`${phone.brand}|${phone.model}`) || null;
}

function priceOf(phone) {
  if (!phone) return null;
  return prices.get(`${phone.brand}|${phone.model}`) || null;
}

function priceAmount(entry) {
  return finiteNumber(entry?.price);
}

function chipRecord(chip) {
  if (typeof chip !== "string" || !chip || chipScores == null || typeof chipScores !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(chipScores, chip)) {
    const direct = chipScores[chip];
    return direct && typeof direct === "object" && !Array.isArray(direct) ? direct : null;
  }
  const norm = normalizeChip(chip);
  let best = null;
  for (const [key, entry] of Object.entries(chipScores)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const other = normalizeChip(key);
    if (!other || !norm) continue;
    if (norm.includes(other) || other.includes(norm)) {
      if (!best || other.length > best.length) best = { entry, length: other.length };
    }
  }
  return best ? best.entry : null;
}

function chipScore(chip) {
  return finiteNumber(chipRecord(chip)?.spec26_at_6w);
}

function chipConfidence(chip) {
  const confidence = chipRecord(chip)?.spec26_6w_confidence;
  return typeof confidence === "string" ? confidence : null;
}

function recomputeSpec26Max() {
  spec26Max = 0;
  for (const phone of phones) {
    const score = chipScore(phone?.chip);
    if (score != null && score > spec26Max) spec26Max = score;
  }
}

function chipBarPercent(value) {
  if (!Number.isFinite(value) || !(spec26Max > 0)) return 0;
  return Math.max(0, Math.min(100, (value / spec26Max) * 100));
}

function formatChipScore(value) {
  return Number(value).toFixed(2);
}

function normalizeChip(value) {
  return String(value).toLowerCase().replace(/\s+/g, "");
}

function finiteNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function numericValue(phone, field) {
  return finiteNumber(phone?.[field]);
}

function barPercent(value, other, invert) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(other) || value === other) return 100;
  if (!invert) {
    const max = Math.max(value, other);
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, (value / max) * 100));
  }
  const min = Math.min(value, other);
  if (value <= 0) return 0;
  return Math.max(0, Math.min(100, (min / value) * 100));
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

function formatWeightNumber(value) {
  const tenths = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
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
  chipScore,
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
