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

const picker = {
  a: { brand: "", query: "", slug: "" },
  b: { brand: "", query: "", slug: "" },
};

let phones = [];
let bySlug = new Map();

const els = {
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  app: document.getElementById("app"),
  workspace: document.getElementById("workspace"),
  empty: document.getElementById("empty"),
  filterEmpty: document.getElementById("filter-empty"),
  same: document.getElementById("same"),
  compareWrap: document.getElementById("compare-wrap"),
  coreOnly: document.getElementById("core-only"),
  scopeCount: document.getElementById("scope-count"),
  tbody: document.querySelector("#compare tbody"),
  headA: document.getElementById("head-a"),
  headB: document.getElementById("head-b"),
};

init();

async function init() {
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
    els.workspace.hidden = true;
    els.empty.hidden = false;
    return;
  }

  fillBrandSelect(document.getElementById("brand-a"));
  fillBrandSelect(document.getElementById("brand-b"));
  bindPicker("a");
  bindPicker("b");
  els.coreOnly.addEventListener("change", () => refresh());
  chooseDefaults();
  refresh();
}

function showError(message) {
  els.loading.hidden = true;
  els.error.hidden = false;
  els.error.textContent = message;
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
  const labels = { filing: "申報", press: "報導" };
  link.textContent = labels[phone.battery_source_type] || "電池來源";
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
