"use strict";
/* ============================================================
   Finanzplaner – Marcel & Elena
   Daten: localStorage + optionaler Cloud-Sync (privates GitHub-Repo) + JSON-Export
   ============================================================ */

const STORAGE_KEY = "finanzplaner_v1";
const RHYTHMEN = { "monatlich": 1, "vierteljährlich": 3, "halbjährlich": 6, "jährlich": 12 };
const PERSONEN = ["Marcel", "Elena"];
const GOALS = { eigenheim: "Eigenheim", urlaub: "Urlaub", altersvorsorge: "Altersvorsorge", sonstiges: "Sonstiges" };

let uidCounter = 1;
function uid() { return "id" + Date.now().toString(36) + (uidCounter++); }

/* ---------- Startdaten (aus Finanzplanung_neu.xlsx + Urlaubsbudgetplanung 2026.xlsx) ---------- */
function pos(name, min, max, paid) { return { id: uid(), name, min, max, paid }; }
function vac(name, date, days, positions) { return { id: uid(), name, date, days, positions }; }
/* Zukunftsplanung – neutrale Startwerte (keine persönlichen Daten) */
function defaultZukunft() {
  return {
    targetYM: (new Date().getFullYear() + 2) + "-01", growth: 2.5, fixInflation: 2,
    assets: [], budget: [], fixkosten: [],
    haus: { rate: 0, zins: 3.8, jahre: 30, eigenkapital: 0, nebenkosten: 12 }
  };
}
function defaultState() {
  return {
    settings: { splitMode: "einkommen", customMarcel: 50, dashFilter: "Gesamt" },
    ui: { blocks: {}, cats: {} },
    categories: ["Wohnen", "Lebensmittel", "Mobilität", "Versicherungen", "Abos", "Kommunikation", "Sport/Mitgliedschaften", "Spenden", "Sonstiges"],
    incomes: [], costs: [], savings: [], konsum: [], extras: [],
    urlaub: { balance: 0, basis: "mittel", vacations: [], deposits: [] },
    eigenheim: { target: 0, current: 0, zins: 0, deposits: [], rateChanges: [] },
    alters: { current: 0, years: 30, zins: 5.0, inflation: 2.0 },
    zukunft: defaultZukunft(),
    snapshots: [],
    notes: "",
    versicherungen: { wohnflaeche: 0, eigentum: false, auto: false, items: [] }
  };
}

/* ---------- Persistenz ---------- */
let state;
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { state = JSON.parse(raw); migrate(); lastSer = serState(); return; }
  } catch (e) { console.warn("localStorage nicht verfügbar", e); }
  state = defaultState(); lastSer = serState();
}
function migrate() {
  if (!state.urlaub.deposits) state.urlaub.deposits = [];
  if (!state.urlaub.basis) state.urlaub.basis = "mittel";
  (state.urlaub.vacations || []).forEach(v => {
    if (!v.positions) {
      v.positions = [pos("Gesamtkosten", v.cost || 0, v.cost || 0, 0)];
      delete v.cost;
    }
    if (v.days == null) v.days = 0;
    if (v.draft == null) v.draft = false;
    if (v.travelers !== "Marcel" && v.travelers !== "Elena") v.travelers = "2";
    (v.positions || []).forEach(p => { p.name = mapVacPos(p.name); });
    if (v.start == null) {
      v.start = v.date ? v.date + "-01" : "";
      v.end = v.start ? addDaysISO(v.start, Math.max(0, (v.days || 1) - 1)) : "";
    }
  });
  if (!state.settings.dashFilter) state.settings.dashFilter = "Gesamt";
  if (state.eigenheim.zins == null) state.eigenheim.zins = 0;
  if (!state.eigenheim.deposits) state.eigenheim.deposits = [];
  if (!state.eigenheim.rateChanges) state.eigenheim.rateChanges = [];
  if (!state.zukunft) state.zukunft = defaultZukunft();
  if (state.zukunft.fixInflation == null) state.zukunft.fixInflation = 5;
  (state.zukunft.assets || []).forEach(a => {
    if (!a.typ) {
      const n = (a.name || "").toLowerCase();
      a.typ = n.includes("altersvorsorge") ? "altersvorsorge" : n.includes("eigenheim") ? "eigenheim" : "sonstiges";
    }
  });
  if (!state.ui) state.ui = { blocks: {}, cats: {} };
  if (!state.ui.blocks) state.ui.blocks = {};
  if (!state.ui.cats) state.ui.cats = {};
  if (state.notes == null) state.notes = "";
  if (!state.versicherungen) state.versicherungen = { wohnflaeche: 0, eigentum: false, auto: false, items: [] };
  if (!state.versicherungen.items) state.versicherungen.items = [];
}
let lastSer = "";
function serState() { const { meta, ...rest } = state; return JSON.stringify(rest); }
function persistLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* kein Storage verfügbar */ }
}
/* Wird bei jedem render() aufgerufen – speichert/synchronisiert nur bei echter Änderung */
function save() {
  const ser = serState();
  if (ser === lastSer) return;
  lastSer = ser;
  state.meta = { updatedAt: Date.now() };
  persistLocal();
  scheduleAutosave();
  scheduleCloudPush();
}

/* ---------- Formatierung ---------- */
const fmtEur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const fmtEur0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtPct = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });
function eur(v) { return fmtEur.format(v || 0); }
function eur0(v) { return fmtEur0.format(v || 0); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function num(v) { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; }

/* ---------- Berechnungen ---------- */
function monthly(item) { return (item.amount || 0) / (RHYTHMEN[item.rhythm] || 1); }
function incomeOf(p) { return state.incomes.filter(i => i.person === p).reduce((s, i) => s + (i.amount || 0), 0); }
function totalIncome() { return state.incomes.reduce((s, i) => s + (i.amount || 0), 0); }
function sharedCosts() { return state.costs.filter(c => c.person === "Gemeinsam").reduce((s, c) => s + monthly(c), 0); }
function persCosts(p) { return state.costs.filter(c => c.person === p).reduce((s, c) => s + monthly(c), 0); }
function shareOf(p) {
  const m = state.settings.splitMode;
  if (m === "50") return 0.5;
  if (m === "custom") { const cm = (state.settings.customMarcel || 0) / 100; return p === "Marcel" ? cm : 1 - cm; }
  const ti = totalIncome();
  return ti > 0 ? incomeOf(p) / ti : 0.5;
}
function fixOf(p) { return persCosts(p) + shareOf(p) * sharedCosts(); }
function savingsOf(p) { return state.savings.filter(s => s.person === p).reduce((s, i) => s + (i.amount || 0), 0); }
function totalSavings() { return state.savings.reduce((s, i) => s + (i.amount || 0), 0); }
function savingsForGoal(g) { return state.savings.filter(s => s.goal === g).reduce((s, i) => s + (i.amount || 0), 0); }
function konsumOf(p) { return state.konsum.filter(k => k.person === p).reduce((s, i) => s + (i.amount || 0), 0); }
function totalKonsum() { return state.konsum.reduce((s, i) => s + (i.amount || 0), 0); }
function totalCosts() { return sharedCosts() + PERSONEN.reduce((s, p) => s + persCosts(p), 0); }
function restOf(p) { return incomeOf(p) - fixOf(p) - savingsOf(p) - konsumOf(p); }
function restTotal() { return totalIncome() - totalCosts() - totalSavings() - totalKonsum(); }

function nowYM() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function monthsBetween(fromYM, toYM) {
  const [fy, fm] = fromYM.split("-").map(Number), [ty, tm] = toYM.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
function ymLabel(ym) {
  const M = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const [y, m] = ym.split("-").map(Number);
  return M[m - 1] + " " + y;
}
function addMonths(ym, n) {
  let [y, m] = ym.split("-").map(Number);
  m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1;
  return y + "-" + String(m).padStart(2, "0");
}

/* Urlaubs-Detailkalkulation: Positionen mit Min/Max/Bezahlt */
const VAC_KATEGORIEN = ["Unterkunft", "Anreise", "Mobilität vor Ort", "Verpflegung", "Aktivität", "Sonstiges"];
function mapVacPos(n) {
  if (VAC_KATEGORIEN.includes(n)) return n;
  const x = (n || "").toLowerCase();
  if (x.includes("unterkunft") || x.includes("hotel")) return "Unterkunft";
  if (x.includes("anreise") || x.includes("flug") || x.includes("sprit")) return "Anreise";
  if (x.includes("öffi") || x.includes("mobilit") || x.includes("mietwagen") || x.includes("taxi")) return "Mobilität vor Ort";
  if (x.includes("verpflegung") || x.includes("essen") || x.includes("restaurant")) return "Verpflegung";
  if (x.includes("aktivität") || x.includes("aktivitaet") || x.includes("skipass") || x.includes("eintritt")) return "Aktivität";
  return "Sonstiges";
}
function posOpen(p, which) { // which: 'min'|'max'
  return Math.max(0, (p[which] || 0) - (p.paid || 0));
}
function posOpenBasis(p) {
  const b = state.urlaub.basis || "mittel";
  if (b === "min") return posOpen(p, "min");
  if (b === "max") return posOpen(p, "max");
  return (posOpen(p, "min") + posOpen(p, "max")) / 2;
}
function vacTotals(v) {
  const t = { min: 0, max: 0, paid: 0, openMin: 0, openMax: 0, open: 0 };
  (v.positions || []).forEach(p => {
    t.min += p.min || 0; t.max += p.max || 0; t.paid += p.paid || 0;
    t.openMin += posOpen(p, "min"); t.openMax += posOpen(p, "max"); t.open += posOpenBasis(p);
  });
  return t;
}
function todayISO() {
  const d = new Date();
  const p = x => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function isPastVac(v) {
  // Ein Urlaub ist erst abgeschlossen, wenn sein tatsächliches Enddatum vorbei ist.
  // Dadurch bleibt ein mehrtägiger Urlaub bis zum Ende des Zeitraums unter „Geplant“.
  if (v.end) return v.end < todayISO();
  return v.date && monthsBetween(nowYM(), v.date) < 0;
}
function addDaysISO(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  const p = x => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/* von/bis konsistent halten: Monat + Reisetage werden automatisch abgeleitet */
function syncVacDates(v) {
  if (v.start && v.end && v.end < v.start) v.end = v.start;
  if (v.start) v.date = v.start.slice(0, 7);
  if (v.start && v.end) v.days = Math.round((new Date(v.end + "T12:00:00") - new Date(v.start + "T12:00:00")) / 86400000) + 1;
}

/* Urlaubsplanung: Topf + Sparrate + Sondereinnahmen gegen offene Restkosten */
function futureDeposits() {
  const start = nowYM();
  return (state.urlaub.deposits || []).filter(d => d.date && monthsBetween(start, d.date) >= 0);
}
function vacationPlan() {
  const rate = savingsForGoal("urlaub");
  const vacs = state.urlaub.vacations.slice().filter(v => !v.draft && v.date && !isPastVac(v)).sort((a, b) => a.date.localeCompare(b.date));
  const start = nowYM();
  const deps = futureDeposits();
  const depUpTo = m => deps.filter(d => monthsBetween(start, d.date) <= m).reduce((s, d) => s + (d.amount || 0), 0);
  let results = [], cum = 0;
  vacs.forEach(v => {
    const t = vacTotals(v);
    cum += t.open;
    const m = Math.max(0, monthsBetween(start, v.date));
    const dep = depUpTo(m);
    const available = state.urlaub.balance + rate * m + dep;
    const needed = m > 0 ? Math.max(0, (cum - state.urlaub.balance - dep) / m) : (cum > state.urlaub.balance + dep ? Infinity : 0);
    results.push({ id: v.id, name: v.name, date: v.date, open: t.open, months: m, cum, available, needed, ok: available >= cum - 0.005 });
  });
  return {
    rate, vacs: results,
    openTotal: results.reduce((s, r) => s + r.open, 0),
    depositsPlanned: deps.reduce((s, d) => s + (d.amount || 0), 0),
    requiredRate: results.reduce((mx, r) => Math.max(mx, r.needed === Infinity ? 0 : r.needed), 0),
    anyImpossible: results.some(r => r.needed === Infinity && !r.ok)
  };
}

/* Auswertung: alle Urlaube (vergangene: bezahlt = Ist, geplante: bezahlt + offen = Schätzung) */
function vacAnalysis() {
  const items = state.urlaub.vacations.slice().filter(v => v.date && !v.draft).sort((a, b) => a.date.localeCompare(b.date)).map(v => {
    const t = vacTotals(v), past = isPastVac(v);
    const total = past ? t.paid : t.paid + t.open;
    const byPos = {};
    (v.positions || []).forEach(p => {
      const val = past ? (p.paid || 0) : (p.paid || 0) + posOpenBasis(p);
      if (val > 0.004) byPos[p.name || "Sonstiges"] = (byPos[p.name || "Sonstiges"] || 0) + val;
    });
    const trav = (v.travelers === "Marcel" || v.travelers === "Elena") ? 1 : 2;
    const naechte = (v.days || 0) > 1 ? (v.days - 1) : 0;
    const acc = (v.positions || []).filter(p => (p.name || "").toLowerCase().includes("unterkunft"))
      .reduce((sm, p) => sm + (past ? (p.paid || 0) : (p.paid || 0) + posOpenBasis(p)), 0);
    return { v, t, past, total, byPos, trav, naechte,
      perDay: v.days > 0 ? total / v.days : null,
      accPerNightPerson: (acc > 0 && naechte > 0) ? acc / naechte / trav : null };
  });
  const byYear = {};
  items.forEach(it => { const y = it.v.date.slice(0, 4); byYear[y] = (byYear[y] || 0) + it.total; });
  return { items, byYear };
}

/* Aktuelle Stände aus der Vermögensprognose (Zukunft-Tab) */
function assetSumFor(kind) {
  return (state.zukunft && state.zukunft.assets || []).filter(a => a.typ === kind).reduce((s, a) => s + (a.stand || 0), 0);
}

/* Eigenheim-Prognose: verzinst, mit Sondereinnahmen und jahresweise anpassbarer Sparrate */
function homeRateAt(ym) {
  let rate = savingsForGoal("eigenheim");
  (state.eigenheim.rateChanges || [])
    .filter(c => c.from)
    .sort((a, b) => a.from.localeCompare(b.from))
    .forEach(c => { if (c.from <= ym) rate = c.rate || 0; });
  return rate;
}
function homePlan() {
  const e = state.eigenheim;
  const baseRate = savingsForGoal("eigenheim");
  const target = e.target || 0, current = assetSumFor("eigenheim");
  const r = (e.zins || 0) / 100 / 12;
  const start = nowYM();
  const missing = Math.max(0, target - current);
  const labels = [ymLabel(start)], series = [current];
  let bal = current, months = null;
  if (target > 0 && missing > 0) {
    for (let m = 1; m <= 600; m++) {
      const ym = addMonths(start, m);
      bal = bal * (1 + r) + homeRateAt(ym);
      labels.push(ymLabel(ym)); series.push(Math.round(bal * 100) / 100);
      if (bal >= target) { months = m; break; }
      if (m >= 599 && homeRateAt(ym) <= 0 && r <= 0) break;
    }
  } else if (missing <= 0) months = 0;
  return {
    rate: baseRate, target, current, missing, months,
    doneYM: months ? addMonths(start, months) : (months === 0 ? start : null),
    labels, series
  };
}

/* Altersvorsorge: Zinseszins mit monatlicher Einzahlung – optional je Person */
function retAssetsFor(p) {
  const av = (state.zukunft && state.zukunft.assets || []).filter(a => a.typ === "altersvorsorge");
  const mine = av.filter(a => (a.name || "").toLowerCase().includes(p.toLowerCase()));
  const unassigned = av.filter(a => !PERSONEN.some(pp => (a.name || "").toLowerCase().includes(pp.toLowerCase())));
  return mine.reduce((sm, a) => sm + (a.stand || 0), 0) + unassigned.reduce((sm, a) => sm + (a.stand || 0), 0) / PERSONEN.length;
}
function retRateFor(p) { return state.savings.filter(sv => sv.goal === "altersvorsorge" && sv.person === p).reduce((sm, i) => sm + (i.amount || 0), 0); }
function retirementSeries(person) {
  const { years, zins, inflation } = state.alters;
  const current = person ? retAssetsFor(person) : assetSumFor("altersvorsorge");
  const rate = person ? retRateFor(person) : savingsForGoal("altersvorsorge");
  const r = (zins || 0) / 100 / 12, infl = (inflation || 0) / 100;
  const nominal = [], real = [], labels = [];
  let v = current || 0;
  const y0 = new Date().getFullYear();
  for (let y = 0; y <= (years || 0); y++) {
    labels.push(String(y0 + y));
    nominal.push(v);
    real.push(v / Math.pow(1 + infl, y));
    for (let m = 0; m < 12; m++) v = v * (1 + r) + rate;
  }
  return { labels, nominal, real, rate, endNominal: nominal[nominal.length - 1] || 0, endReal: real[real.length - 1] || 0 };
}

/* ---------- Charts ---------- */
const charts = {};
function makeChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, cfg);
}
const C = { teal: "#2dd4bf", blue: "#60a5fa", violet: "#a78bfa", amber: "#fbbf24", rose: "#fb7185", green: "#4ade80", slate: "#64748b", grid: "rgba(148,163,184,.12)", text: "#cbd5e1" };
const PALETTE = ["#2dd4bf", "#60a5fa", "#a78bfa", "#fbbf24", "#fb7185", "#4ade80", "#f472b6", "#38bdf8", "#facc15", "#94a3b8"];

function baseScales(moneyY = true) {
  return {
    x: { grid: { color: C.grid }, ticks: { color: C.text } },
    y: { grid: { color: C.grid }, ticks: { color: C.text, callback: v => moneyY ? eur0(v) : v } }
  };
}
const tipMoney = { callbacks: { label: ctx => (ctx.dataset.label ? ctx.dataset.label + ": " : "") + eur(ctx.parsed.y ?? ctx.parsed) } };
/* Zeichnet Prozentwerte direkt in die Segmente eines Kuchen-/Donut-Diagramms */
const pctLabelsPlugin = {
  id: "pctLabels",
  afterDatasetsDraw(chart) {
    const ds = chart.data.datasets[0];
    if (!ds) return;
    const total = ds.data.reduce((sm, v) => sm + (v || 0), 0);
    if (!total) return;
    const ctx = chart.ctx;
    chart.getDatasetMeta(0).data.forEach((arc, i) => {
      const val = ds.data[i] || 0;
      if (val / total < 0.03) return; // sehr kleine Segmente nicht beschriften
      const p = arc.getCenterPoint ? arc.getCenterPoint() : arc.tooltipPosition();
      ctx.save();
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(Math.round(val / total * 100) + " %", p.x, p.y);
      ctx.restore();
    });
  }
};

/* ---------- Rendering ---------- */
function activeTab() { return document.querySelector(".tab.active")?.dataset.tab || "dashboard"; }

function render() {
  save();
  const tab = activeTab();
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("visible", p.id === "panel-" + tab));
  if (tab === "dashboard") renderDashboard();
  if (tab === "budget") renderBudget();
  if (tab === "urlaub") renderUrlaub();
  if (tab === "zukunft") { renderZukunft(); renderZiele(); }
  if (tab === "verlauf") renderVerlauf();
  if (tab === "versicherungen") renderVersicherungen();
  if (tab === "notizen") renderNotizen();
  // Eingeklappte Blöcke anwenden
  document.querySelectorAll(".block").forEach(b =>
    b.classList.toggle("collapsed", !!(state.ui && state.ui.blocks && state.ui.blocks[b.dataset.block])));
}

/* ----- Dashboard ----- */
function renderDashboard() {
  const f = state.settings.dashFilter || "Gesamt";
  const isAll = f === "Gesamt";
  const ti = isAll ? totalIncome() : incomeOf(f);
  const fix = isAll ? totalCosts() : fixOf(f);
  const sp = isAll ? totalSavings() : savingsOf(f);
  const ko = isAll ? totalKonsum() : konsumOf(f);
  const rest = ti - fix - sp - ko;
  const q = ti > 0 ? sp / ti : 0;
  const vp = vacationPlan(), hp = homePlan(), rs = retirementSeries();

  // Filter-Buttons
  document.getElementById("dashFilter").innerHTML = ["Gesamt", ...PERSONEN].map(p =>
    `<button class="btn seg-btn ${f === p ? "seg-active" : ""}" data-action="dash-filter" data-person="${p}">${p}</button>`).join("");

  const kpis = [
    { label: "Einnahmen / Monat", val: eur(ti), sub: isAll ? "Marcel " + eur0(incomeOf("Marcel")) + " · Elena " + eur0(incomeOf("Elena")) : "nur " + f, cls: "" },
    { label: "Fixkosten / Monat", val: eur(fix), sub: (isAll ? "" : "inkl. " + fmtPct.format(shareOf(f)) + " Anteil gemeinsam · ") + (ti > 0 ? fmtPct.format(fix / ti) + " der Einnahmen" : ""), cls: "" },
    { label: "Sparrate / Monat", val: eur(sp), sub: "Sparquote " + fmtPct.format(q), cls: "good" },
    { label: "Frei verfügbar", val: eur(rest), sub: "nach Fixkosten, Sparen & Konsum-Budget", cls: rest < 0 ? "bad" : "good" }
  ];
  document.getElementById("kpiRow").innerHTML = kpis.map(k =>
    `<div class="card kpi ${k.cls}"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.val}</div><div class="kpi-sub">${k.sub}</div></div>`).join("");

  // Warnungen
  const warns = [];
  if (rest < 0) warns.push("Das Gesamtbudget ist negativ (" + eur(rest) + ") – Ausgaben oder Sparraten prüfen.");
  PERSONEN.forEach(p => { if (restOf(p) < 0) warns.push("Puffer von " + p + " ist negativ (" + eur(restOf(p)) + ")."); });
  vp.vacs.filter(v => !v.ok).forEach(v => warns.push("Urlaub „" + v.name + "“ ist mit aktueller Sparrate nicht erreichbar."));
  if (hp.target > 0 && hp.rate <= 0) warns.push("Für das Eigenheim-Ziel ist keine Sparrate hinterlegt.");
  document.getElementById("warnBox").innerHTML = warns.length
    ? warns.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join("")
    : `<div class="ok-msg">✓ Alles im grünen Bereich – keine Warnungen.</div>`;

  // Sparziel-Fortschritt
  const goals = [];
  const upcoming = vp.openTotal;
  if (upcoming > 0 || state.urlaub.balance > 0) goals.push({ name: "Urlaubstopf", cur: state.urlaub.balance, target: upcoming || null, extra: (vp.rate > 0 ? "+" + eur0(vp.rate) + "/Monat · " : "") + "offene Urlaubs-Restkosten " + eur0(upcoming) });
  if (hp.target > 0) goals.push({ name: "Eigenheim", cur: hp.current, target: hp.target, extra: hp.months != null ? "Ziel ca. " + ymLabel(hp.doneYM) : "" });
  goals.push({ name: "Altersvorsorge", cur: assetSumFor("altersvorsorge"), target: null, extra: "+" + eur0(rs.rate) + "/Monat · Prognose " + eur0(rs.endNominal) + " in " + state.alters.years + " J." });
  document.getElementById("goalBars").innerHTML = goals.map(g => {
    const pct = g.target ? Math.min(100, g.cur / g.target * 100) : null;
    return `<div class="goal"><div class="goal-head"><span>${esc(g.name)}</span><span>${eur0(g.cur)}${g.target ? " / " + eur0(g.target) : ""}</span></div>
      ${pct != null ? `<div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>` : ""}
      <div class="goal-sub">${esc(g.extra)}</div></div>`;
  }).join("");

  // Donut Budgetaufteilung – Sparen aufgeteilt nach Altersvorsorge, Eigenheim und Rest
  const savGoal = g => state.savings.filter(sv => sv.goal === g && (isAll || sv.person === f)).reduce((sm, i) => sm + (i.amount || 0), 0);
  const spAV = savGoal("altersvorsorge"), spEH = savGoal("eigenheim"), spRest = Math.max(0, sp - spAV - spEH);
  makeChart("chartBudgetDonut", {
    type: "doughnut",
    data: {
      labels: ["Fixkosten", "Altersvorsorge", "Eigenheim", "Sonstiges", "Konsum", rest >= 0 ? "Frei verfügbar" : "Defizit"],
      datasets: [{ data: [fix, spAV, spEH, spRest, ko, Math.abs(rest)], backgroundColor: [C.blue, C.violet, C.teal, "#38bdf8", C.amber, rest >= 0 ? C.green : C.rose], borderWidth: 0 }]
    },
    plugins: [pctLabelsPlugin],
    options: { plugins: { legend: { position: "bottom", labels: { color: C.text } }, tooltip: { callbacks: { label: ctx => ctx.label + ": " + eur(ctx.parsed) } } }, cutout: "62%" }
  });

  // Balken: Fixkosten nach Kategorie (bei Personenfilter: persönliche + Anteil gemeinsam)
  const byCat = {};
  state.costs.forEach(c => {
    let v = monthly(c);
    if (!isAll) {
      if (c.person === "Gemeinsam") v *= shareOf(f);
      else if (c.person !== f) v = 0;
    }
    if (v > 0.004) byCat[c.category] = (byCat[c.category] || 0) + v;
  });
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  makeChart("chartCatBar", {
    type: "bar",
    data: { labels: cats, datasets: [{ label: "€/Monat", data: cats.map(c => byCat[c]), backgroundColor: cats.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 6 }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => eur(ctx.parsed.x) } } }, scales: { x: { grid: { color: C.grid }, ticks: { color: C.text, callback: v => eur0(v) } }, y: { grid: { display: false }, ticks: { color: C.text } } } }
  });
}

/* ----- Budget ----- */
function personBadge(p) { return `<span class="badge p-${p === "Gemeinsam" ? "g" : p === "Marcel" ? "m" : "e"}">${p}</span>`; }

function renderBudget() {
  // Übersichtstabelle wie Excel
  const rows = [
    ["Einnahmen", totalIncome(), incomeOf("Marcel"), incomeOf("Elena")],
    ["Fixkosten (inkl. Anteil gemeinsam)", totalCosts(), fixOf("Marcel"), fixOf("Elena")],
    ["Sparen", totalSavings(), savingsOf("Marcel"), savingsOf("Elena")],
    ["Konsum-Budget", totalKonsum(), konsumOf("Marcel"), konsumOf("Elena")],
    ["Puffer (Rest)", restTotal(), restOf("Marcel"), restOf("Elena")]
  ];
  document.getElementById("budgetSummary").innerHTML = `
    <table class="tbl"><thead><tr><th>Monatlicher Plan</th><th class="r">Gesamt</th><th class="r">Marcel</th><th class="r">Elena</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${i === 4 ? "total-row" : ""}"><td>${r[0]}</td>${r.slice(1).map(v =>
      `<td class="r ${i === 4 ? (v < 0 ? "neg" : "pos") : ""}">${eur(v)}</td>`).join("")}</tr>`).join("")}
    </tbody></table>
    <div class="hint">Gemeinsame Fixkosten (${eur(sharedCosts())}) aufgeteilt: Marcel ${fmtPct.format(shareOf("Marcel"))} · Elena ${fmtPct.format(shareOf("Elena"))}</div>`;

  // Split-Einstellung
  const s = state.settings;
  document.getElementById("splitBox").innerHTML = `
    <label class="radio"><input type="radio" name="split" value="einkommen" ${s.splitMode === "einkommen" ? "checked" : ""}> Einkommensproportional</label>
    <label class="radio"><input type="radio" name="split" value="50" ${s.splitMode === "50" ? "checked" : ""}> 50 / 50</label>
    <label class="radio"><input type="radio" name="split" value="custom" ${s.splitMode === "custom" ? "checked" : ""}> Eigener Schlüssel</label>
    ${s.splitMode === "custom" ? `<div class="slider-row"><span>Marcel ${s.customMarcel} %</span>
      <input type="range" min="0" max="100" value="${s.customMarcel}" data-action="split-custom"><span>Elena ${100 - s.customMarcel} %</span></div>` : ""}`;

  // Einnahmen
  document.getElementById("incomeTable").innerHTML = tableHTML(
    ["Bezeichnung", "Person", "Betrag/Monat", ""],
    state.incomes.map(i => [
      inp("text", i.id, "incomes", "name", i.name),
      selPerson(i.id, "incomes", i.person, false),
      inp("number", i.id, "incomes", "amount", i.amount),
      delBtn(i.id, "incomes")
    ]),
    "Summe: " + eur(totalIncome()),
    true
  );

  // Fixkosten nach Kategorie gruppiert
  const catDl = `<datalist id="catList">${state.categories.map(c => `<option value="${esc(c)}">`).join("")}</datalist>`;
  const groups = {};
  state.costs.forEach(c => { (groups[c.category] = groups[c.category] || []).push(c); });
  const catOrder = state.categories.filter(c => groups[c]).concat(Object.keys(groups).filter(c => !state.categories.includes(c)));
  const groupHTML = catOrder.map(cat => {
    const collapsed = !!state.ui.cats[cat];
    return `
    <div class="cat-group">
      <div class="cat-head">
        <span><button class="btn-icon chev-btn ${collapsed ? "rot" : ""}" data-action="toggle-cat" data-cat="${esc(cat)}" title="Ein-/Ausklappen">▾</button> <span class="cat-name">${esc(cat)}</span></span>
        <span style="display:flex;align-items:center;gap:10px">${eur(sumM(groups[cat]))} / Monat <button class="btn" data-action="add-cost-cat" data-cat="${esc(cat)}">+ Position</button></span>
      </div>
      ${collapsed ? "" : tableHTML(["Bezeichnung", "Person", "Kategorie", "Betrag", "Rhythmus", "€/Monat", ""],
        groups[cat].map(c => [
          inp("text", c.id, "costs", "name", c.name),
          selPerson(c.id, "costs", c.person, true),
          `<input type="text" list="catList" value="${esc(c.category)}" data-id="${c.id}" data-list="costs" data-field="category" data-action="edit">`,
          inp("number", c.id, "costs", "amount", c.amount),
          `<select data-id="${c.id}" data-list="costs" data-field="rhythm" data-action="edit">${Object.keys(RHYTHMEN).map(r =>
            `<option ${c.rhythm === r ? "selected" : ""}>${r}</option>`).join("")}</select>`,
          `<span class="mono">${eur(monthly(c))}</span>`,
          delBtn(c.id, "costs")
        ]), null, true)}
    </div>`;
  }).join("");
  document.getElementById("costGroups").innerHTML = catDl + groupHTML +
    `<div class="hint">Neue Kategorie? Einfach beim Hinzufügen einen neuen Namen eintippen – sie erscheint automatisch als Gruppe.</div>`;
  document.getElementById("costSum").textContent = eur(totalCosts()) + " / Monat gesamt";

  // Sparraten
  document.getElementById("savingsTable").innerHTML = tableHTML(
    ["Bezeichnung", "Person", "Betrag/Monat", "Ziel", ""],
    state.savings.map(sv => [
      inp("text", sv.id, "savings", "name", sv.name),
      selPerson(sv.id, "savings", sv.person, false),
      inp("number", sv.id, "savings", "amount", sv.amount),
      `<select data-id="${sv.id}" data-list="savings" data-field="goal" data-action="edit">${Object.keys(GOALS).map(g =>
        `<option value="${g}" ${sv.goal === g ? "selected" : ""}>${GOALS[g]}</option>`).join("")}</select>`,
      delBtn(sv.id, "savings")
    ]),
    "Summe: " + eur(totalSavings()) + " / Monat",
    true
  );

  // Konsum
  document.getElementById("konsumTable").innerHTML = tableHTML(
    ["Bezeichnung", "Person", "Betrag/Monat", ""],
    state.konsum.map(k => [
      inp("text", k.id, "konsum", "name", k.name),
      selPerson(k.id, "konsum", k.person, false),
      inp("number", k.id, "konsum", "amount", k.amount),
      delBtn(k.id, "konsum")
    ]),
    "Summe: " + eur(totalKonsum()) + " / Monat",
    true
  );

  // Zusatzeinnahmen
  const year = new Date().getFullYear();
  const yearExtras = state.extras.filter(e => e.date && e.date.startsWith(String(year)));
  const sumExtras = yearExtras.reduce((s, e) => s + (e.amount || 0), 0);
  document.getElementById("extrasTable").innerHTML = tableHTML(
    ["Monat", "Person", "Bezeichnung", "Betrag", ""],
    state.extras.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(e => [
      `<input type="month" value="${esc(e.date)}" data-id="${e.id}" data-list="extras" data-field="date" data-action="edit">`,
      selPerson(e.id, "extras", e.person, false),
      inp("text", e.id, "extras", "name", e.name),
      inp("number", e.id, "extras", "amount", e.amount),
      delBtn(e.id, "extras")
    ]),
    `Zusatzeinnahmen ${year}: ${eur(sumExtras)} (Ø ${eur(sumExtras / 12)}/Monat) – nicht im Monatspuffer enthalten`
  );
}
function sumM(arr) { return arr.reduce((s, c) => s + monthly(c), 0); }
function inp(type, id, list, field, val) {
  const v = type === "number" ? (val ?? 0) : esc(val);
  return `<input type="${type}" ${type === "number" ? 'step="0.01" class="r"' : ""} value="${v}" data-id="${id}" data-list="${list}" data-field="${field}" data-action="edit">`;
}
function selPerson(id, list, val, withGemeinsam) {
  const opts = withGemeinsam ? ["Gemeinsam", ...PERSONEN] : PERSONEN;
  return `<select data-id="${id}" data-list="${list}" data-field="person" data-action="edit">${opts.map(p =>
    `<option ${val === p ? "selected" : ""}>${p}</option>`).join("")}</select>`;
}
function delBtn(id, list) { return `<button class="btn-icon" title="Löschen" data-action="del" data-id="${id}" data-list="${list}">✕</button>`; }
function dragCell() { return `<span class="drag-handle" title="Ziehen zum Sortieren">⠿</span>`; }
function tableHTML(head, rows, footer, draggable) {
  const h = draggable ? [""].concat(head) : head;
  const rr = draggable ? rows.map(r => [dragCell()].concat(r)) : rows;
  return `<table class="tbl edit"><thead><tr>${h.map(x => `<th>${x}</th>`).join("")}</tr></thead>
  <tbody>${rr.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${h.length}" class="empty">Noch keine Einträge</td></tr>`}</tbody>
  ${footer ? `<tfoot><tr><td colspan="${h.length}">${footer}</td></tr></tfoot>` : ""}</table>`;
}

/* ----- Urlaub ----- */
function vacCard(v, planInfo) {
  const t = vacTotals(v);
  const past = !v.draft && isPastVac(v);
  const statusPill = v.draft
    ? `<span class="pill" style="background:rgba(251,191,36,.15);color:var(--amber)">Entwurf – noch nicht gespeichert</span>`
    : past
      ? `<span class="pill" style="background:rgba(148,163,184,.15);color:var(--muted)">abgeschlossen</span>`
      : planInfo
        ? (planInfo.ok ? `<span class="pill ok">erreichbar</span>` : `<span class="pill bad">nicht erreichbar</span>`)
        : "";
  const rows = (v.positions || []).map(p => `
    <tr>
      <td>${dragCell()}</td>
      <td><select data-id="${p.id}" data-vac="${v.id}" data-list="vacpos" data-field="name" data-action="edit">${VAC_KATEGORIEN.map(k =>
        `<option ${p.name === k ? "selected" : ""}>${k}</option>`).join("")}</select></td>
      <td><input type="number" step="0.01" class="r" value="${p.min ?? 0}" data-id="${p.id}" data-vac="${v.id}" data-list="vacpos" data-field="min" data-action="edit"></td>
      <td><input type="number" step="0.01" class="r" value="${p.max ?? 0}" data-id="${p.id}" data-vac="${v.id}" data-list="vacpos" data-field="max" data-action="edit"></td>
      <td><input type="number" step="0.01" class="r" value="${p.paid ?? 0}" data-id="${p.id}" data-vac="${v.id}" data-list="vacpos" data-field="paid" data-action="edit"></td>
      <td class="r mono">${past ? "—" : eur(posOpenBasis(p))}</td>
      <td><button class="btn-icon" title="Position löschen" data-action="del-vacpos" data-id="${p.id}" data-vac="${v.id}">✕</button></td>
    </tr>`).join("");
  return `
  <div class="card vac-card ${past ? "vac-past" : ""}">
    <div class="vac-head">
      <button class="btn-icon chev-btn ${v.collapsed ? "rot" : ""}" data-action="toggle-vac" data-id="${v.id}" title="Details ein-/ausklappen">▾</button>
      <input type="text" class="vac-name" value="${esc(v.name)}" data-id="${v.id}" data-list="vac" data-field="name" data-action="edit">
      <label class="vac-days">von <input type="date" value="${esc(v.start || "")}" data-id="${v.id}" data-list="vac" data-field="start" data-action="edit"></label>
      <label class="vac-days">bis <input type="date" value="${esc(v.end || "")}" data-id="${v.id}" data-list="vac" data-field="end" data-action="edit"></label>
      <span class="chip">${v.days || 0} Tage</span>
      <label class="vac-days">Reisende <select data-id="${v.id}" data-list="vac" data-field="travelers" data-action="edit">
        <option value="2" ${v.travelers !== "Marcel" && v.travelers !== "Elena" ? "selected" : ""}>Zu zweit</option>
        <option value="Marcel" ${v.travelers === "Marcel" ? "selected" : ""}>Marcel</option>
        <option value="Elena" ${v.travelers === "Elena" ? "selected" : ""}>Elena</option>
      </select></label>
      ${statusPill}
      ${v.draft ? `<button class="btn primary" data-action="save-vac" data-id="${v.id}">Speichern</button>` : ""}
      ${!past && planInfo ? `<span class="hint" style="margin:0">in ${planInfo.months} Mon. · nötige Rate ${planInfo.needed === Infinity ? "–" : eur(planInfo.needed)}</span>` : ""}
      <button class="btn-icon" title="Urlaub löschen" data-action="del" data-id="${v.id}" data-list="vac" style="margin-left:auto">✕</button>
    </div>
    <div class="vac-sums">
      <span class="chip">Min ${eur(t.min)}</span><span class="chip">Max ${eur(t.max)}</span>
      <span class="chip chip-paid">Bezahlt ${eur(t.paid)}</span>
      ${past ? "" : `<span class="chip ${t.open > 0 ? "chip-open" : ""}">Offen ${eur(t.open)}</span>`}
      ${v.days > 0 ? `<span class="chip">${eur((past ? t.paid : t.paid + t.open) / v.days)} / Tag</span>` : ""}
    </div>
    ${v.collapsed ? "" : `
    <table class="tbl edit"><thead><tr><th></th><th>Position</th><th>Min</th><th>Max</th><th>Bezahlt</th><th>Offen*</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="empty">Noch keine Positionen</td></tr>`}</tbody></table>
    <button class="btn" style="margin-top:8px" data-action="add-vacpos" data-vac="${v.id}">+ Position</button>`}
  </div>`;
}

function renderUrlaub() {
  const vp = vacationPlan();
  document.getElementById("urlaubBalance").value = state.urlaub.balance;
  document.getElementById("urlaubRate").textContent = eur(vp.rate) + " / Monat";
  document.getElementById("urlaubOpen").textContent = eur(vp.openTotal);
  document.getElementById("urlaubRequired").textContent = vp.vacs.length ? (vp.anyImpossible ? "nicht erreichbar (Termin zu nah)" : eur(vp.requiredRate) + " / Monat") : "—";
  document.getElementById("urlaubRequired").className = "kpi-value " + (vp.vacs.length && (vp.anyImpossible || vp.requiredRate > vp.rate + 0.005) ? "neg" : "pos");
  document.getElementById("urlaubDeposits").textContent = eur(vp.depositsPlanned);

  // Kalkulationsbasis
  // Prognose Topf-Stand zum Jahresende (dieses + folgendes Jahr)
  const deps = futureDeposits();
  const forecastAt = targetYM => {
    const n = Math.max(0, monthsBetween(nowYM(), targetYM));
    let bal = state.urlaub.balance;
    for (let m = 0; m <= n; m++) {
      const ym = addMonths(nowYM(), m);
      if (m > 0) bal += vp.rate;
      deps.filter(dd => dd.date === ym).forEach(dd => bal += (dd.amount || 0));
      vp.vacs.filter(v => v.date === ym).forEach(v => bal -= (v.open || 0));
    }
    return bal;
  };
  const yNow = new Date().getFullYear();
  const endThis = forecastAt(yNow + "-12"), endNext = forecastAt((yNow + 1) + "-12");
  document.getElementById("urlaubForecastLabel").textContent = "Prognose Topf Ende " + (yNow + 1);
  document.getElementById("urlaubForecast").textContent = eur(endNext);
  document.getElementById("urlaubForecast").className = "kpi-value " + (endNext < 0 ? "neg" : "pos");
  document.getElementById("urlaubForecastSub").textContent = "Ende " + yNow + ": " + eur(endThis) + " · inkl. Sparrate, Sondereinnahmen & geplanter Urlaube";

  const b = state.urlaub.basis || "mittel";
  document.getElementById("basisBox").innerHTML = [["min", "Minimum"], ["mittel", "Mittelwert"], ["max", "Maximum"]].map(([val, lab]) =>
    `<label class="radio"><input type="radio" name="vacbasis" value="${val}" ${b === val ? "checked" : ""}> ${lab}</label>`).join("") +
    `<span class="hint" style="margin:0">Basis für „Offen“, Prognose und nötige Rate</span>`;

  // Urlaubskarten: geplante zuerst (chronologisch), dann abgeschlossene
  // Entwürfe bleiben oben an fester Position; einsortiert wird erst nach "Speichern"
  const planned = state.urlaub.vacations.filter(v => v.draft || !isPastVac(v)).sort((a, b) => (a.draft ? "" : a.date || "~").localeCompare(b.draft ? "" : b.date || "~"));
  const past = state.urlaub.vacations.filter(v => !v.draft && isPastVac(v)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const planMap = {};
  vp.vacs.forEach(r => planMap[r.id] = r);
  document.getElementById("vacListPlanned").innerHTML = planned.length
    ? planned.map(v => vacCard(v, planMap[v.id])).join("")
    : `<div class="card"><div class="empty" style="padding:12px;color:var(--muted)">Noch keine geplanten Urlaube – oben „+ Urlaub planen“ klicken.</div></div>`;
  document.getElementById("vacListPast").innerHTML = past.map(v => vacCard(v, null)).join("");
  document.getElementById("pastBlock").style.display = past.length ? "" : "none";

  document.getElementById("vacDepTable").innerHTML = tableHTML(
    ["Monat", "Bezeichnung", "Betrag", ""],
    state.urlaub.deposits.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(dp => [
      `<input type="month" value="${esc(dp.date)}" data-id="${dp.id}" data-list="vacdep" data-field="date" data-action="edit">`,
      inp("text", dp.id, "vacdep", "name", dp.name),
      inp("number", dp.id, "vacdep", "amount", dp.amount),
      delBtn(dp.id, "vacdep")
    ]),
    "Nur Monate ab heute fließen in Prognose & nötige Rate ein. Bereits auf dem Konto gutgeschrieben? Dann in den Kontostand einrechnen und den Eintrag hier löschen."
  );

  renderVacAnalysis();

  // Projektion
  if (vp.vacs.length) {
    const deps = futureDeposits();
    const lastVac = vp.vacs[vp.vacs.length - 1].date;
    const lastDep = deps.reduce((mx, d) => d.date > mx ? d.date : mx, lastVac);
    const endNextYear = (new Date().getFullYear() + 1) + "-12"; // immer mindestens bis Ende des Folgejahres
    const lastYM = [lastVac, lastDep, endNextYear].sort()[2];
    const n = Math.max(1, monthsBetween(nowYM(), lastYM));
    const labels = [], data = [];
    let bal = state.urlaub.balance;
    for (let m = 0; m <= n; m++) {
      const ym = addMonths(nowYM(), m);
      if (m > 0) bal += vp.rate;
      deps.filter(d => d.date === ym).forEach(d => bal += (d.amount || 0));
      vp.vacs.filter(v => v.date === ym).forEach(v => bal -= (v.open || 0));
      labels.push(ymLabel(ym)); data.push(Math.round(bal * 100) / 100);
    }
    document.getElementById("vacChartCard").style.display = "";
    makeChart("chartVacation", {
      type: "line",
      data: { labels, datasets: [{ label: "Urlaubstopf (Prognose)", data, borderColor: C.teal, backgroundColor: "rgba(45,212,191,.12)", fill: true, tension: .3, pointRadius: 2 }] },
      options: { plugins: { legend: { labels: { color: C.text } }, tooltip: tipMoney }, scales: baseScales() }
    });
  } else {
    document.getElementById("vacChartCard").style.display = "none";
  }
}

/* ----- Urlaubs-Auswertung ----- */
let vacSlide = 0;
function renderVacAnalysis() {
  const an = vacAnalysis();
  const show = an.items.length > 0;
  document.getElementById("vacAnalysisWrap").style.display = show ? "" : "none";
  if (!show) return;

  // Kennzahlen
  const planned = an.items.filter(it => !it.past), done = an.items.filter(it => it.past);
  const avg = an.items.reduce((s, it) => s + it.total, 0) / an.items.length;
  const perDayPersonItems = an.items.filter(it => it.perDay != null);
  const avgDayPerson = perDayPersonItems.length ? perDayPersonItems.reduce((s, it) => s + it.perDay / it.trav, 0) / perDayPersonItems.length : null;
  const stats = [
    { label: "Urlaube erfasst", val: an.items.length + "", sub: done.length + " abgeschlossen · " + planned.length + " geplant" },
    { label: "Ø Kosten pro Urlaub", val: eur0(avg), sub: "über alle erfassten Urlaube" },
    { label: "Ø Kosten / Tag / Person", val: avgDayPerson != null ? eur0(avgDayPerson) : "—", sub: avgDayPerson != null ? "fairster Vergleich über Dauer & Reisende" : "Reisetage bei den Urlauben eintragen" },
    { label: "Ø Unterkunft / Nacht / Person", val: (() => { const xs = an.items.filter(it => it.accPerNightPerson != null); return xs.length ? eur0(xs.reduce((sm, it) => sm + it.accPerNightPerson, 0) / xs.length) : "—"; })(), sub: "Position „Unterkunft“, gemessen an Nächten und Reisenden" }
  ];
  document.getElementById("vacStats").innerHTML = stats.map(k =>
    `<div class="card kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value" style="font-size:22px">${k.val}</div><div class="kpi-sub">${esc(k.sub)}</div></div>`).join("");

  // ----- Auswertungs-Karussell (mit Pfeilen/Punkten wechseln) -----
  const years = Object.keys(an.byYear).sort();

  // Daten vorbereiten
  const catTotals = {};
  an.items.forEach(it => Object.keys(it.byPos).forEach(n => { catTotals[n] = (catTotals[n] || 0) + it.byPos[n]; }));
  const catNames = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);

  // Ø pro Tag: nur Urlaube mit Reisetagen berücksichtigen
  const catDay = {}; let daysSum = 0;
  an.items.forEach(it => {
    if ((it.v.days || 0) > 0) {
      daysSum += it.v.days;
      Object.keys(it.byPos).forEach(n => { catDay[n] = (catDay[n] || 0) + it.byPos[n]; });
    }
  });
  const catDayNames = Object.keys(catDay).sort((a, b) => catDay[b] - catDay[a]);
  const catDaySum = catDayNames.reduce((sm, n) => sm + catDay[n], 0);

  const catYear = {}; // Kategorie -> Jahr -> { sum, n } (pro Person normiert)
  an.items.forEach(it => {
    const y = it.v.date.slice(0, 4);
    Object.keys(it.byPos).forEach(n => {
      const o = ((catYear[n] = catYear[n] || {})[y] = catYear[n][y] || { sum: 0, n: 0 });
      o.sum += it.byPos[n] / it.trav; o.n++;
    });
  });

  const daysByYear = {}, dayPersonYear = {};
  an.items.forEach(it => {
    const y = it.v.date.slice(0, 4);
    daysByYear[y] = (daysByYear[y] || 0) + (it.v.days || 0);
    if (it.perDay != null) {
      const o = (dayPersonYear[y] = dayPersonYear[y] || { sum: 0, n: 0 });
      o.sum += it.perDay / it.trav; o.n++;
    }
  });

  const slides = [
    {
      title: "Ø Kosten pro Kategorie pro Tag – alle Urlaube (* = Schätzung inkl. offener Kosten)",
      cfg: {
        type: "doughnut",
        data: { labels: catDayNames, datasets: [{ data: catDayNames.map(n => Math.round(catDay[n] / Math.max(1, daysSum) * 100) / 100), backgroundColor: catDayNames.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }] },
        plugins: [pctLabelsPlugin],
        options: {
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "right", labels: { color: C.text, boxWidth: 12 } },
            tooltip: { callbacks: { label: ctx => " " + ctx.label + ": " + eur(ctx.parsed) + " / Tag" + (catDaySum > 0 ? " (" + Math.round(ctx.parsed * Math.max(1, daysSum) / catDaySum * 100) + " %)" : "") } }
          }
        }
      }
    },
    {
      title: "Ø Kosten pro Kategorie je Urlaub & Person (nach Jahr)",
      cfg: {
        type: "line",
        data: {
          labels: years,
          datasets: catNames.map((n, i) => ({
            label: n,
            data: years.map(y => { const o = (catYear[n] || {})[y]; return o ? Math.round(o.sum / o.n * 100) / 100 : null; }),
            borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length],
            tension: .3, pointRadius: 3, spanGaps: true
          }))
        },
        options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: C.text, boxWidth: 12 } }, tooltip: tipMoney }, scales: baseScales() }
      }
    },
    {
      title: "Urlaubskosten & Urlaubstage pro Jahr",
      cfg: {
        type: "bar",
        data: {
          labels: years,
          datasets: [
            { type: "bar", label: "Kosten", data: years.map(y => Math.round(an.byYear[y] * 100) / 100), backgroundColor: C.teal, borderRadius: 6, maxBarThickness: 90, yAxisID: "y" },
            { type: "line", label: "Urlaubstage", data: years.map(y => daysByYear[y] || 0), borderColor: C.amber, backgroundColor: C.amber, tension: .3, yAxisID: "y1" }
          ]
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: C.text } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ": " + (ctx.dataset.yAxisID === "y1" ? ctx.parsed.y + " Tage" : eur(ctx.parsed.y)) } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: C.text } },
            y: { grid: { color: C.grid }, ticks: { color: C.text, callback: v => eur0(v) } },
            y1: { position: "right", grid: { display: false }, ticks: { color: C.amber, callback: v => v + " T" } }
          }
        }
      }
    },
    {
      title: "Ø Kosten pro Tag & Person je Jahr",
      cfg: {
        type: "line",
        data: {
          labels: years,
          datasets: [{ label: "Ø / Tag / Person", data: years.map(y => { const o = dayPersonYear[y]; return o ? Math.round(o.sum / o.n * 100) / 100 : null; }), borderColor: C.teal, backgroundColor: "rgba(45,212,191,.12)", fill: true, tension: .3, spanGaps: true }]
        },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tipMoney }, scales: baseScales() }
      }
    }
  ];


  vacSlide = ((vacSlide % slides.length) + slides.length) % slides.length;
  const slide = slides[vacSlide];
  document.getElementById("vacSlideTitle").textContent = slide.title;
  makeChart("chartVacSlide", slide.cfg);
  document.getElementById("vacSlideDots").innerHTML = slides.map((sl, i) =>
    `<button data-action="vac-slide-to" data-i="${i}" title="${esc(sl.title)}" style="width:11px;height:11px;border-radius:50%;border:none;cursor:pointer;padding:0;background:${i === vacSlide ? "var(--teal, #2dd4bf)" : "rgba(148,163,184,.35)"}"></button>`).join("");
}

/* ----- Ziele (Eigenheim + Altersvorsorge) ----- */
function renderZiele() {
  const hp = homePlan();
  document.getElementById("homeTarget").value = state.eigenheim.target;
  document.getElementById("homeCurrent").textContent = eur(hp.current);
  document.getElementById("homeZins").value = state.eigenheim.zins;
  document.getElementById("homeRate").textContent = eur(hp.rate) + " / Monat";
  const pct = hp.target > 0 ? Math.min(100, hp.current / hp.target * 100) : 0;
  document.getElementById("homeBar").style.width = pct + "%";
  document.getElementById("homePct").textContent = hp.target > 0 ? fmtPct.format(pct / 100) + " erreicht" : "Zielbetrag eintragen";
  document.getElementById("homeForecast").textContent =
    hp.target <= 0 ? "—" :
    hp.missing <= 0 ? "Ziel erreicht 🎉" :
    hp.months == null ? "mit aktuellen Werten nicht erreichbar (Sparrate prüfen)" :
    "ca. " + ymLabel(hp.doneYM) + " (" + hp.months + " Monate)";

  // Sparraten-Staffel (jahresweise anpassbar)
  document.getElementById("homeRateTable").innerHTML = tableHTML(
    ["Ab Monat", "Sparrate €/Monat", ""],
    [[
      `<span class="mono">Heute (${ymLabel(nowYM())})</span>`,
      `<span class="mono">${eur(hp.rate)}</span> <span class="hint" style="margin:0">aus Budget</span>`,
      ""
    ]].concat((state.eigenheim.rateChanges || []).slice().sort((a, b) => (a.from || "").localeCompare(b.from || "")).map(rc => [
      `<input type="month" value="${esc(rc.from)}" data-id="${rc.id}" data-list="homerate" data-field="from" data-action="edit">`,
      inp("number", rc.id, "homerate", "rate", rc.rate),
      delBtn(rc.id, "homerate")
    ])),
    "Heute = aktuelle Rate aus dem Budget-Tab. Jede weitere Zeile ersetzt die Rate ab dem angegebenen Monat (Prognose)."
  );

  if (hp.target > 0 && hp.missing > 0 && hp.series.length > 1) {
    document.getElementById("homeChartCard").style.display = "";
    makeChart("chartHome", {
      type: "line",
      data: { labels: hp.labels, datasets: [
        { label: "Eigenheim-Konto (inkl. Zins)", data: hp.series, borderColor: C.blue, backgroundColor: "rgba(96,165,250,.12)", fill: true, tension: .2, pointRadius: 0 },
        { label: "Zielbetrag", data: hp.labels.map(() => hp.target), borderColor: C.amber, borderDash: [6, 4], fill: false, pointRadius: 0 }
      ] },
      options: { plugins: { legend: { labels: { color: C.text } }, tooltip: tipMoney }, scales: baseScales() }
    });
  } else document.getElementById("homeChartCard").style.display = "none";

  // Altersvorsorge – nach Person aufgeteilt
  const a = state.alters, rsAll = retirementSeries();
  document.getElementById("retCurrent").textContent = eur(assetSumFor("altersvorsorge"));
  document.getElementById("retYears").value = a.years;
  document.getElementById("retZins").value = a.zins;
  document.getElementById("retInfl").value = a.inflation;
  document.getElementById("retRate").textContent = eur(rsAll.rate) + " / Monat";
  const persSeries = PERSONEN.map(p => ({ p, rs: retirementSeries(p), cur: retAssetsFor(p) }));
  document.getElementById("retPersons").innerHTML = persSeries.map(({ p, rs, cur }) => {
    const invested = cur + rs.rate * 12 * (a.years || 0);
    return `<div class="card">
      <h3 style="display:flex;align-items:center;gap:8px">${personBadge(p)} Altersvorsorge</h3>
      <div class="grid c2" style="margin-top:10px">
        <div><div class="kpi-label">Aktueller Stand</div><div class="kpi-value" style="font-size:20px">${eur0(cur)}</div><div class="kpi-sub">+ ${eur0(rs.rate)} / Monat (aus Budget)</div></div>
        <div><div class="kpi-label">Endwert nominal</div><div class="kpi-value pos" style="font-size:20px">${eur0(rs.endNominal)}</div><div class="kpi-sub">real ${eur0(rs.endReal)}</div></div>
      </div>
      <div class="kpi-sub" style="margin-top:8px">${eur0(invested)} eingezahlt · ${eur0(rs.endNominal - invested)} Zinsertrag</div>
    </div>`;
  }).join("");

  makeChart("chartRet", {
    type: "line",
    data: {
      labels: rsAll.labels,
      datasets: [
        ...persSeries.map(({ p, rs }, i) => ({ label: p + " (nominal)", data: rs.nominal, borderColor: i === 0 ? C.blue : C.rose, tension: .25, pointRadius: 0 })),
        { label: "Gesamt (nominal)", data: rsAll.nominal, borderColor: C.violet, backgroundColor: "rgba(167,139,250,.10)", fill: true, tension: .25, pointRadius: 0, borderWidth: 3 },
        { label: "Gesamt real (inflationsbereinigt)", data: rsAll.real, borderColor: C.amber, borderDash: [6, 4], fill: false, tension: .25, pointRadius: 0 }
      ]
    },
    options: { plugins: { legend: { labels: { color: C.text } }, tooltip: tipMoney }, scales: baseScales() }
  });
}

/* ----- Zukunft (Vermögensprognose, Budgetplanung, Hauskauf) ----- */
function effBudgetAmount(it, fixTotal) { return it.link === "fixkosten" ? -fixTotal : (it.amount || 0); }

function renderZukunft() {
  const z = state.zukunft;
  const months = Math.max(0, monthsBetween(nowYM(), z.targetYM));
  document.getElementById("zuTarget").value = z.targetYM;
  document.getElementById("zuGrowth").value = z.growth;
  document.getElementById("zuMonths").textContent = "Monate bis Stichtag: " + months;

  /* --- Vermögensprognose --- */
  const g = 1 + (z.growth || 0) / 100;
  const arows = z.assets.map(a => {
    const fixGes = (a.monthly || 0) * months;
    const prog = ((a.stand || 0) + fixGes + (a.varDep || 0)) * g;
    return { a, fixGes, prog };
  });
  const sumStand = arows.reduce((s, r) => s + (r.a.stand || 0), 0);
  const sumProg = arows.reduce((s, r) => s + r.prog, 0);
  const TYPEN = { eigenheim: "Eigenheim", altersvorsorge: "Altersvorsorge", sonstiges: "Sonstiges" };
  document.getElementById("zAssetTable").innerHTML = tableHTML(
    ["Vermögenswert", "Konto", "Zuordnung", "Stand heute", "Einz. monatl.", "Einz. gesamt", "Var. Einz. (gesch.)", "Prognose", ""],
    arows.map(({ a, fixGes, prog }) => [
      inp("text", a.id, "zassets", "name", a.name),
      inp("text", a.id, "zassets", "konto", a.konto),
      `<select data-id="${a.id}" data-list="zassets" data-field="typ" data-action="edit">${Object.keys(TYPEN).map(k =>
        `<option value="${k}" ${a.typ === k ? "selected" : ""}>${TYPEN[k]}</option>`).join("")}</select>`,
      inp("number", a.id, "zassets", "stand", a.stand),
      inp("number", a.id, "zassets", "monthly", a.monthly),
      `<span class="mono">${eur(fixGes)}</span>`,
      inp("number", a.id, "zassets", "varDep", a.varDep),
      `<span class="mono pos">${eur(prog)}</span>`,
      delBtn(a.id, "zassets")
    ]),
    `Gesamt heute: ${eur(sumStand)} → Prognose ${ymLabel(z.targetYM)}: <b>${eur(sumProg)}</b> (inkl. ${z.growth} % Wachstumsfaktor) · Die Zuordnung speist „Aktueller Stand“ bei Eigenheim & Altersvorsorge`,
    true
  );
  makeChart("chartZAssets", {
    type: "bar",
    data: {
      labels: [...arows.map(r => r.a.name), "Gesamt"],
      datasets: [
        { label: "Stand heute", data: [...arows.map(r => r.a.stand || 0), sumStand], backgroundColor: "rgba(100,116,139,.75)", borderRadius: 6 },
        { label: "Prognose " + ymLabel(z.targetYM), data: [...arows.map(r => Math.round(r.prog * 100) / 100), Math.round(sumProg * 100) / 100], backgroundColor: C.teal, borderRadius: 6 }
      ]
    },
    options: { plugins: { legend: { labels: { color: C.text } }, tooltip: tipMoney }, scales: baseScales() }
  });

  /* --- Budgetplanung ab Stichtag --- */
  const fixRaw = z.fixkosten.reduce((s, f) => s + (f.amount || 0), 0);
  const fixTotal = fixRaw * (1 + (z.fixInflation || 0) / 100);
  document.getElementById("zfixInfl").value = z.fixInflation;
  const gross = z.budget.reduce((s, it) => s + Math.max(0, effBudgetAmount(it, fixTotal)), 0);
  let running = 0;
  const brows = z.budget.map(it => {
    const val = effBudgetAmount(it, fixTotal);
    running += val;
    return { it, val, run: running };
  });
  document.getElementById("zBudgetTable").innerHTML = tableHTML(
    ["Baustein", "Betrag", "Anteil v. Gehalt", "Zwischensumme", "Bemerkung", ""],
    brows.map(({ it, val, run }) => [
      inp("text", it.id, "zbudget", "name", it.name),
      it.link === "fixkosten"
        ? `<span class="mono neg" title="Automatisch: Summe der Fixkosten-Liste unten">${eur(val)} 🔗</span>`
        : inp("number", it.id, "zbudget", "amount", it.amount),
      `<span class="mono">${val < 0 && gross > 0 ? fmtPct.format(-val / gross) : ""}</span>`,
      `<span class="mono ${run < 0 ? "neg" : ""}">${eur(run)}</span>`,
      inp("text", it.id, "zbudget", "note", it.note),
      delBtn(it.id, "zbudget")
    ]),
    `Restbudget: <b>${eur(running)}</b> / Monat · Reihenfolge per ⠿ sortierbar, Zwischensummen laufen mit`,
    true
  );
  /* --- Fixkosten-Detail --- */
  document.getElementById("zFixTable").innerHTML = tableHTML(
    ["Position", "Betrag", "Bemerkung", ""],
    z.fixkosten.map(f => [
      inp("text", f.id, "zfix", "name", f.name),
      inp("number", f.id, "zfix", "amount", f.amount),
      inp("text", f.id, "zfix", "note", f.note),
      delBtn(f.id, "zfix")
    ]),
    `Summe: ${eur(fixRaw)} + ${z.fixInflation} % Inflationsfaktor = <b>${eur(fixTotal)}</b> / Monat – fließt automatisch in die 🔗-Zeile der Budgetplanung`,
    true
  );
  makeChart("chartZFix", {
    type: "doughnut",
    data: {
      labels: z.fixkosten.map(f => f.name),
      datasets: [{ data: z.fixkosten.map(f => f.amount || 0), backgroundColor: z.fixkosten.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }]
    },
    options: { plugins: { legend: { position: "right", labels: { color: C.text, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ctx.label + ": " + eur(ctx.parsed) } } }, cutout: "55%" }
  });

  /* --- Hauskauf-Simulation --- */
  const h = z.haus;
  document.getElementById("hausRate").value = h.rate;
  document.getElementById("hausZins").value = h.zins;
  document.getElementById("hausJahre").value = h.jahre;
  document.getElementById("hausEK").value = h.eigenkapital;
  document.getElementById("hausNK").value = h.nebenkosten;
  const zi = (h.zins || 0) / 100 / 12, n = (h.jahre || 0) * 12;
  const kredit = (h.rate || 0) > 0 && n > 0 ? (zi > 0 ? h.rate * (1 - Math.pow(1 + zi, -n)) / zi : h.rate * n) : 0;
  const kaufbudget = kredit + (h.eigenkapital || 0);
  const maxPreis = kaufbudget / (1 + (h.nebenkosten || 0) / 100);
  document.getElementById("hausResults").innerHTML = [
    { l: "Mögliche Kreditsumme", v: eur0(kredit), s: "Annuität bei " + h.zins + " % Zins, " + h.jahre + " Jahre Volltilgung" },
    { l: "Kaufbudget gesamt", v: eur0(kaufbudget), s: "Kreditsumme + Eigenkapital" },
    { l: "Max. Kaufpreis Immobilie", v: eur0(maxPreis), s: "nach Abzug der Nebenkosten", cls: "pos" },
    { l: "Kaufnebenkosten", v: eur0(maxPreis * (h.nebenkosten || 0) / 100), s: h.nebenkosten + " % (Steuer, Notar, ggf. Makler)" }
  ].map(k => `<div><div class="kpi-label">${k.l}</div><div class="kpi-value ${k.cls || ""}" style="font-size:22px">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join("");
}

/* ----- Verlauf ----- */
function renderVerlauf() {
  const snaps = state.snapshots.slice().sort((a, b) => a.ym.localeCompare(b.ym));
  document.getElementById("snapTable").innerHTML = tableHTML(
    ["Monat", "Urlaubstopf", "Eigenheim", "Altersvorsorge", "Fixkosten", "Sparraten", ""],
    snaps.map(s => [
      `<span class="mono">${ymLabel(s.ym)}</span>`,
      inp("number", s.ym, "snap", "urlaub", s.urlaub),
      inp("number", s.ym, "snap", "eigenheim", s.eigenheim),
      inp("number", s.ym, "snap", "alters", s.alters),
      inp("number", s.ym, "snap", "fix", s.fix ?? ""),
      inp("number", s.ym, "snap", "spar", s.spar ?? ""),
      `<button class="btn-icon" data-action="del-snap" data-id="${s.ym}" title="Löschen">✕</button>`
    ]),
    snaps.length ? null : undefined
  );
  if (snaps.length >= 2) {
    document.getElementById("snapChartCard").style.display = "";
    makeChart("chartSnaps", {
      type: "line",
      data: {
        labels: snaps.map(s => ymLabel(s.ym)),
        datasets: [
          { label: "Eigenheim", data: snaps.map(s => s.eigenheim), borderColor: C.blue, tension: .3 },
          { label: "Altersvorsorge", data: snaps.map(s => s.alters), borderColor: C.violet, tension: .3 }
        ]
      },
      options: { plugins: { legend: { labels: { color: C.text } }, tooltip: tipMoney }, scales: baseScales() }
    });
    makeChart("chartSnapsBudget", {
      type: "line",
      data: {
        labels: snaps.map(s => ymLabel(s.ym)),
        datasets: [
          { label: "Fixkosten / Monat", data: snaps.map(s => s.fix ?? null), borderColor: C.rose, tension: .3, spanGaps: true },
          { label: "Sparraten / Monat", data: snaps.map(s => s.spar ?? null), borderColor: C.green, tension: .3, spanGaps: true }
        ]
      },
      options: { plugins: { legend: { labels: { color: C.text } }, tooltip: tipMoney }, scales: baseScales() }
    });
  } else document.getElementById("snapChartCard").style.display = "none";
}

/* ----- Versicherungscheck ----- */
const VERS_ARTEN = ["Privathaftpflicht", "Berufsunfähigkeit", "Auslandskrankenversicherung", "Hausrat", "Risikoleben", "Wohngebäude", "Elementar", "KFZ-Haftpflicht", "KFZ-Kasko", "Rechtsschutz", "Unfall", "Zahnzusatz", "Sonstige"];
function insMonthly(i) { return (i.beitrag || 0) / (RHYTHMEN[i.rhythm] || 1); }

function insuranceCheck() {
  const V = state.versicherungen;
  const items = V.items || [];
  const has = art => items.some(i => i.art === art);
  const sumFor = art => items.filter(i => i.art === art).reduce((sm, i) => sm + (i.summe || 0), 0);
  const mk = (status, titel, text) => ({ status, titel, text });
  const res = [];

  // Privathaftpflicht – mind. 10 Mio. € (Verbraucherzentrale)
  const phv = items.filter(i => i.art === "Privathaftpflicht");
  if (!phv.length) res.push(mk("bad", "Privathaftpflicht", "Fehlt – die wichtigste Versicherung überhaupt: Sie deckt Schäden, für die ihr unbegrenzt mit dem gesamten Vermögen haftet. Empfehlung: Paartarif mit mind. 10 Mio. € (ideal 50 Mio. €) inkl. Forderungsausfalldeckung, ab ca. 20–50 €/Jahr."));
  else {
    const mx = Math.max(...phv.map(i => i.summe || 0));
    if (mx >= 10000000) res.push(mk("ok", "Privathaftpflicht", "Vorhanden mit " + eur0(mx) + " Deckungssumme – ausreichend (Empfehlung: mind. 10 Mio. €, ideal 50 Mio. €)."));
    else res.push(mk("warn", "Privathaftpflicht", "Vorhanden, aber die Deckungssumme (" + eur0(mx) + ") liegt unter der empfohlenen Mindestgrenze von 10 Mio. € – aufstocken oder Tarif wechseln."));
  }

  // Berufsunfähigkeit – je Person, 70–80 % vom Netto
  PERSONEN.forEach(p => {
    const bu = items.filter(i => i.art === "Berufsunfähigkeit" && i.person === p);
    const netto = incomeOf(p);
    const ziel = Math.round(netto * 0.7), zielHi = Math.round(netto * 0.8);
    if (!bu.length) res.push(mk("bad", "Berufsunfähigkeit – " + p, "Fehlt – neben der Haftpflicht die wichtigste Absicherung (jeder Vierte wird im Erwerbsleben berufsunfähig). Empfohlene BU-Rente: 70–80 % vom Netto" + (netto ? " ≈ " + eur0(ziel) + "–" + eur0(zielHi) + " / Monat" : "") + ", Laufzeit bis 67."));
    else {
      const rente = bu.reduce((sm, i) => sm + (i.summe || 0), 0);
      if (!netto || rente >= ziel) res.push(mk("ok", "Berufsunfähigkeit – " + p, "Vorhanden mit " + eur0(rente) + " Monatsrente" + (netto ? " (" + Math.round(rente / netto * 100) + " % vom Netto; Empfehlung 70–80 %)" : "") + "."));
      else res.push(mk("warn", "Berufsunfähigkeit – " + p, "Monatsrente " + eur0(rente) + " = " + Math.round(rente / netto * 100) + " % vom Netto (" + eur0(netto) + ") – unter der Empfehlung von 70–80 % (" + eur0(ziel) + "–" + eur0(zielHi) + "). Aufstocken prüfen."));
    }
  });

  // Auslandsreisekranken – Pflicht bei Reisen
  const plannedVacs = (state.urlaub.vacations || []).filter(v => !v.draft && v.date && !isPastVac(v)).length;
  if (has("Auslandskrankenversicherung")) res.push(mk("ok", "Auslandsreisekranken", "Vorhanden – gut: Die GKV zahlt im Ausland nur eingeschränkt und einen Rücktransport nie."));
  else res.push(mk(plannedVacs ? "bad" : "warn", "Auslandsreisekranken", "Fehlt" + (plannedVacs ? " – und ihr habt aktuell " + plannedVacs + " geplante Urlaube" : "") + ". Jahresverträge gibt es für unter 10–20 €/Jahr – klare Empfehlung der Verbraucherzentrale."));

  // Hausrat – 650 €/m²
  const flaeche = V.wohnflaeche || 0, hrZiel = flaeche * 650, hr = sumFor("Hausrat");
  if (!has("Hausrat")) res.push(mk("warn", "Hausrat", "Fehlt – sinnvoll, wenn die Einrichtung bei Totalschaden (Brand, Leitungswasser, Einbruch) nicht aus eigener Tasche ersetzbar wäre. Faustregel: 650 €/m²" + (flaeche ? " = " + eur0(hrZiel) + " bei " + flaeche + " m²" : " (oben Wohnfläche eintragen)") + "."));
  else if (flaeche && hr < hrZiel) res.push(mk("warn", "Hausrat", "Versicherungssumme " + eur0(hr) + " liegt unter der Faustregel 650 €/m² × " + flaeche + " m² = " + eur0(hrZiel) + " – es droht Unterversicherung (anteilige Kürzung im Schadenfall)."));
  else res.push(mk("ok", "Hausrat", "Vorhanden mit " + eur0(hr) + (flaeche ? " (Faustregel-Ziel " + eur0(hrZiel) + " bei " + flaeche + " m² erfüllt)" : "") + "."));

  // Risikoleben – relevant mit Eigenheim-Plan
  const homePlanned = (state.eigenheim.target || 0) > 0;
  if (has("Risikoleben")) res.push(mk("ok", "Risikoleben", "Vorhanden mit " + eur0(sumFor("Risikoleben")) + ". Faustregel: mind. Darlehenshöhe bzw. 3–4 Bruttojahresgehälter (kinderloses Paar)."));
  else if (homePlanned) res.push(mk("warn", "Risikoleben", "Noch nicht vorhanden – spätestens mit dem Immobilienkredit wichtig, damit der Partner die Raten allein tragen könnte. Faustregel: mind. Darlehenshöhe, sonst 3–4 Bruttojahresgehälter. Tipp: über Kreuz versichern (jeder versichert das Leben des anderen)."));
  else res.push(mk("info", "Risikoleben", "Aktuell verzichtbar (kein Kredit, keine Kinder) – wird mit Immobilienkredit oder Familie wichtig."));

  // Wohngebäude + Elementar
  if (V.eigentum) {
    if (has("Wohngebäude")) {
      res.push(mk("ok", "Wohngebäude", "Vorhanden – Pflichtprogramm für Eigentümer (Feuer, Leitungswasser, Sturm/Hagel)."));
      res.push(has("Elementar") ? mk("ok", "Elementarschäden", "Zusatzbaustein vorhanden – deckt Hochwasser, Starkregen, Rückstau u. a., die die Wohngebäudeversicherung nicht abdeckt.")
        : mk("warn", "Elementarschäden", "Fehlt – Wohngebäude deckt Sturm/Hagel/Blitz, aber nicht Hochwasser, Starkregen oder Rückstau. Der Baustein wird jedem Eigentümer empfohlen."));
    } else res.push(mk("bad", "Wohngebäude", "Fehlt – für Eigentümer unverzichtbar, idealerweise direkt inkl. Elementarbaustein."));
  } else res.push(mk("info", "Wohngebäude + Elementar", "Erst mit Wohneigentum relevant – beim Hauskauf direkt inkl. Elementarschäden abschließen."));

  // KFZ
  if (V.auto) res.push(has("KFZ-Haftpflicht") ? mk("ok", "KFZ-Haftpflicht", "Vorhanden (gesetzlich vorgeschrieben). Voll-/Teilkasko je nach Fahrzeugwert und -alter abwägen.")
    : mk("bad", "KFZ-Haftpflicht", "Auto vorhanden, aber keine KFZ-Haftpflicht erfasst – sie ist gesetzlich vorgeschrieben."));
  else res.push(mk("info", "KFZ", "Kein Auto angegeben – nicht relevant."));

  // Rechtsschutz – optional
  res.push(has("Rechtsschutz") ? mk("ok", "Rechtsschutz", "Vorhanden – kein Muss, aber je nach Situation (Arbeit, Verkehr, Mieten) sinnvoll. Bausteine prüfen: Nur zahlen, was gebraucht wird.")
    : mk("info", "Rechtsschutz", "Kein Muss laut Verbraucherzentrale – bei Bedarf gezielt Bausteine (Arbeit, Verkehr) wählen statt Komplettpaket."));

  return res;
}

function renderVersicherungen() {
  const V = state.versicherungen;
  document.getElementById("versWohnflaeche").value = V.wohnflaeche || 0;
  document.getElementById("versEigentum").checked = !!V.eigentum;
  document.getElementById("versAuto").checked = !!V.auto;

  const items = V.items || [];
  const mSum = items.reduce((sm, i) => sm + insMonthly(i), 0);
  const checks = insuranceCheck();
  const scored = checks.filter(c => c.status !== "info");
  const okCount = scored.filter(c => c.status === "ok").length;

  document.getElementById("versKpis").innerHTML = [
    { label: "Beitrag / Monat", val: eur(mSum), sub: "über alle Policen" },
    { label: "Beitrag / Jahr", val: eur(mSum * 12), sub: items.length + " Policen erfasst" },
    { label: "Check erfüllt", val: okCount + " / " + scored.length, sub: "relevante Empfehlungen", cls: okCount === scored.length ? "pos" : (scored.some(c => c.status === "bad") ? "neg" : "") },
    { label: "Handlungsbedarf", val: String(scored.filter(c => c.status === "bad").length), sub: scored.filter(c => c.status === "warn").length + " weitere Hinweise", cls: scored.some(c => c.status === "bad") ? "neg" : "pos" }
  ].map(k => `<div class="card kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value ${k.cls || ""}" style="font-size:22px">${k.val}</div><div class="kpi-sub">${k.sub}</div></div>`).join("");

  const artSel = i => `<select data-id="${i.id}" data-list="vers" data-field="art" data-action="edit">${VERS_ARTEN.map(a2 =>
    `<option ${i.art === a2 ? "selected" : ""}>${a2}</option>`).join("")}</select>`;
  document.getElementById("versTable").innerHTML = tableHTML(
    ["Art", "Anbieter / Tarif", "Person", "Deckung / Leistung €", "Beitrag", "Rhythmus", "€/Monat", ""],
    items.map(i => [
      artSel(i),
      inp("text", i.id, "vers", "name", i.name),
      selPerson(i.id, "vers", i.person, true),
      inp("number", i.id, "vers", "summe", i.summe),
      inp("number", i.id, "vers", "beitrag", i.beitrag),
      `<select data-id="${i.id}" data-list="vers" data-field="rhythm" data-action="edit">${Object.keys(RHYTHMEN).map(r =>
        `<option ${i.rhythm === r ? "selected" : ""}>${r}</option>`).join("")}</select>`,
      `<span class="mono">${eur(insMonthly(i))}</span>`,
      delBtn(i.id, "vers")
    ]),
    "Bei Berufsunfähigkeit als „Deckung/Leistung“ die monatliche BU-Rente eintragen, sonst die Versicherungs-/Deckungssumme.",
    true
  );

  const pill = st => st === "ok" ? `<span class="pill ok">✓ passt</span>`
    : st === "warn" ? `<span class="pill" style="background:rgba(251,191,36,.15);color:var(--amber)">⚠ prüfen</span>`
    : st === "bad" ? `<span class="pill bad">✕ fehlt</span>`
    : `<span class="pill" style="background:rgba(148,163,184,.15);color:var(--muted)">ℹ Info</span>`;
  document.getElementById("versCheckList").innerHTML = checks.map(c => `
    <div class="card" style="margin-bottom:10px;display:flex;gap:14px;align-items:flex-start">
      <div style="flex:0 0 auto;padding-top:2px">${pill(c.status)}</div>
      <div><b>${esc(c.titel)}</b><div class="kpi-sub" style="margin-top:4px;line-height:1.55">${esc(c.text)}</div></div>
    </div>`).join("");
}

/* ----- Notizen ----- */
function renderNotizen() {
  const ta = document.getElementById("notesArea");
  if (ta && document.activeElement !== ta) ta.value = state.notes || "";
}
document.getElementById("notesArea").addEventListener("input", e => { state.notes = e.target.value; save(); });

/* ---------- Events ---------- */
function listRef(name) {
  return { incomes: state.incomes, costs: state.costs, savings: state.savings, konsum: state.konsum, extras: state.extras, vac: state.urlaub.vacations, vacdep: state.urlaub.deposits, vers: state.versicherungen.items, homerate: state.eigenheim.rateChanges, zassets: state.zukunft.assets, zbudget: state.zukunft.budget, zfix: state.zukunft.fixkosten }[name];
}

document.addEventListener("change", e => {
  const t = e.target;
  if (t.name === "split") { state.settings.splitMode = t.value; render(); return; }
  if (t.name === "vacbasis") { state.urlaub.basis = t.value; render(); return; }
  if (t.dataset.action === "split-custom") { state.settings.customMarcel = num(t.value); render(); return; }
  if (t.dataset.action === "vers-flag") { state.versicherungen[t.dataset.flag] = t.checked; render(); return; }
  if (t.dataset.action === "edit") {
    if (t.dataset.list === "vacpos") {
      const v = state.urlaub.vacations.find(x => x.id === t.dataset.vac);
      const p = v && (v.positions || []).find(x => x.id === t.dataset.id);
      if (p) p[t.dataset.field] = (t.type === "number") ? num(t.value) : t.value;
      render(); return;
    }
    if (t.dataset.list === "snap") {
      const s = state.snapshots.find(x => x.ym === t.dataset.id);
      if (s) s[t.dataset.field] = num(t.value);
      render(); return;
    }
    const arr = listRef(t.dataset.list);
    const item = arr && arr.find(x => x.id === t.dataset.id);
    if (item) {
      const f = t.dataset.field;
      if (t.type === "month" || t.type === "date") {
        // Nur gueltige (vollstaendige) Werte uebernehmen - leere Zwischenstaende ignorieren
        if (t.value) item[f] = t.value;
        if (t.dataset.list === "vac" && (f === "start" || f === "end")) syncVacDates(item);
        // Solange das Feld den Fokus hat (Nutzer tippt noch), nicht neu rendern,
        // sonst verliert das Datumsfeld bei jeder Teileingabe den Fokus.
        if (document.activeElement === t) {
          t.addEventListener("blur", () => render(), { once: true });
          return;
        }
      } else {
        item[f] = (t.type === "number") ? num(t.value) : t.value;
      }
      if (t.dataset.list === "costs" && f === "category" && t.value && !state.categories.includes(t.value)) state.categories.push(t.value);
    }
    render();
  }
});

/* Klick auf ein Datums-/Monatsfeld oeffnet direkt die Kalenderauswahl */
document.addEventListener("click", e => {
  const inp = e.target;
  if (inp instanceof HTMLInputElement && (inp.type === "date" || inp.type === "month") && typeof inp.showPicker === "function") {
    try { inp.showPicker(); } catch (err) { /* Browser ohne Unterstuetzung: normales Verhalten */ }
  }
});

document.addEventListener("click", e => {
  const t = e.target.closest("[data-action],[data-tab]");
  if (!t) return;
  if (t.dataset.tab) {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
    render(); window.scrollTo(0, 0);
    if (t.scrollIntoView) t.scrollIntoView({ inline: "center", block: "nearest" });
    return;
  }
  const a = t.dataset.action;
  if (a === "del") {
    const arr = listRef(t.dataset.list);
    const i = arr.findIndex(x => x.id === t.dataset.id);
    if (i >= 0 && confirm("Eintrag wirklich löschen?")) { arr.splice(i, 1); render(); }
  }
  if (a === "del-snap") {
    const i = state.snapshots.findIndex(s => s.ym === t.dataset.id);
    if (i >= 0) { state.snapshots.splice(i, 1); render(); }
  }
  if (a === "add-income") { state.incomes.push({ id: uid(), name: "Neue Einnahme", person: "Marcel", amount: 0 }); render(); }
  if (a === "add-cost") {
    const cat = prompt("Kategorie (neu oder bestehend):", state.categories[0]);
    if (cat == null) return;
    if (cat && !state.categories.includes(cat)) state.categories.push(cat);
    state.costs.push({ id: uid(), name: "Neue Position", person: "Gemeinsam", category: cat || "Sonstiges", amount: 0, rhythm: "monatlich" });
    render();
  }
  if (a === "add-cost-cat") {
    state.costs.push({ id: uid(), name: "Neue Position", person: "Gemeinsam", category: t.dataset.cat || "Sonstiges", amount: 0, rhythm: "monatlich" });
    render();
  }
  if (a === "add-saving") { state.savings.push({ id: uid(), name: "Neue Sparrate", person: "Marcel", amount: 0, goal: "sonstiges" }); render(); }
  if (a === "add-konsum") { state.konsum.push({ id: uid(), name: "Neues Budget", person: "Marcel", amount: 0 }); render(); }
  if (a === "add-extra") { state.extras.push({ id: uid(), date: nowYM(), person: "Marcel", name: "Zusatzeinnahme", amount: 0 }); render(); }
  if (a === "add-vac") {
    const nv = vac("Neuer Urlaub", "", 0, [
      pos("Unterkunft", 0, 0, 0), pos("Anreise", 0, 0, 0), pos("Verpflegung", 0, 0, 0), pos("Aktivität", 0, 0, 0)
    ]);
    nv.draft = true; nv.start = ""; nv.end = ""; nv.travelers = "2";
    state.urlaub.vacations.push(nv);
    render();
  }
  if (a === "save-vac") {
    const v = state.urlaub.vacations.find(x => x.id === t.dataset.id);
    if (v) {
      if (!v.start || !v.end) { alert("Bitte zuerst den Zeitraum (von/bis) auswählen."); return; }
      v.draft = false;
      render();
    }
  }
  if (a === "add-vacpos") {
    const v = state.urlaub.vacations.find(x => x.id === t.dataset.vac);
    if (v) { (v.positions = v.positions || []).push(pos("Sonstiges", 0, 0, 0)); render(); }
  }
  if (a === "del-vacpos") {
    const v = state.urlaub.vacations.find(x => x.id === t.dataset.vac);
    if (v) {
      const i = (v.positions || []).findIndex(x => x.id === t.dataset.id);
      if (i >= 0 && confirm("Position wirklich löschen?")) { v.positions.splice(i, 1); render(); }
    }
  }
  if (a === "add-vacdep") { state.urlaub.deposits.push({ id: uid(), name: "Sondereinnahme", date: addMonths(nowYM(), 1), amount: 0 }); render(); }
  if (a === "vac-slide") { vacSlide += parseInt(t.dataset.dir, 10) || 0; render(); }
  if (a === "vac-slide-to") { vacSlide = parseInt(t.dataset.i, 10) || 0; render(); }
  if (a === "add-vers") { state.versicherungen.items.push({ id: uid(), art: "Privathaftpflicht", name: "", person: "Gemeinsam", summe: 0, beitrag: 0, rhythm: "jährlich" }); render(); }
  if (a === "add-homerate") { state.eigenheim.rateChanges.push({ id: uid(), from: addMonths(nowYM(), 12), rate: savingsForGoal("eigenheim") }); render(); }
  if (a === "add-zasset") { state.zukunft.assets.push({ id: uid(), name: "Neuer Vermögenswert", konto: "", typ: "sonstiges", stand: 0, monthly: 0, varDep: 0 }); render(); }
  if (a === "add-zbudget") { state.zukunft.budget.push({ id: uid(), name: "Neuer Baustein", amount: 0, note: "", link: "" }); render(); }
  if (a === "add-zfix") { state.zukunft.fixkosten.push({ id: uid(), name: "Neue Position", amount: 0, note: "" }); render(); }
  if (a === "dash-filter") { state.settings.dashFilter = t.dataset.person; render(); }
  if (a === "toggle-block") {
    if (e.target.closest("input,select") || (e.target.closest("button") && !e.target.closest("[data-action='toggle-block']"))) return;
    state.ui.blocks[t.dataset.key] = !state.ui.blocks[t.dataset.key];
    render();
  }
  if (a === "toggle-vac") {
    const v = state.urlaub.vacations.find(x => x.id === t.dataset.id);
    if (v) { v.collapsed = !v.collapsed; render(); }
  }
  if (a === "toggle-cat") {
    state.ui.cats[t.dataset.cat] = !state.ui.cats[t.dataset.cat];
    render();
  }
  if (a === "autosave") { connectAutosave(); }
  if (a === "settings") openSettings();
  if (a === "settings-close") closeSettings();
  if (a === "sync-connect") connectSync();
  if (a === "sync-disconnect") disconnectSync();
  if (a === "sync-now") syncNow();
  if (a === "pin-set") setPin();
  if (a === "pin-remove") removePin();
  if (a === "lock-now") { closeSettings(); lockNow(); }
  if (a === "snapshot") {
    const ym = nowYM();
    const ex = state.snapshots.find(s => s.ym === ym);
    const snap = { ym, urlaub: state.urlaub.balance, eigenheim: assetSumFor("eigenheim"), alters: assetSumFor("altersvorsorge"), fix: Math.round(totalCosts() * 100) / 100, spar: totalSavings() };
    if (ex) Object.assign(ex, snap); else state.snapshots.push(snap);
    render();
  }
  if (a === "export") {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "finanzplan-daten-" + nowYM() + ".json";
    link.click(); URL.revokeObjectURL(url);
  }
  if (a === "import") document.getElementById("importFile").click();
  if (a === "reset" && confirm("Wirklich ALLE Daten löschen und leer starten? (Bei aktivem Cloud-Sync wird auch der Cloud-Stand überschrieben.)")) { state = defaultState(); render(); }
});

document.getElementById("importFile").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try { state = JSON.parse(r.result); migrate(); render(); alert("Daten erfolgreich importiert."); }
    catch { alert("Datei konnte nicht gelesen werden."); }
  };
  r.readAsText(f);
  e.target.value = "";
});

/* direkte Eingabefelder (Urlaub/Ziele) */
function bindDirect(id, fn) {
  document.getElementById(id).addEventListener("change", e => { fn(num(e.target.value)); render(); });
}
bindDirect("urlaubBalance", v => state.urlaub.balance = v);
bindDirect("homeTarget", v => state.eigenheim.target = v);
bindDirect("homeZins", v => state.eigenheim.zins = v);
bindDirect("zuGrowth", v => state.zukunft.growth = v);
bindDirect("zfixInfl", v => state.zukunft.fixInflation = v);
bindDirect("hausRate", v => state.zukunft.haus.rate = v);
bindDirect("hausZins", v => state.zukunft.haus.zins = v);
bindDirect("hausJahre", v => state.zukunft.haus.jahre = Math.max(1, Math.round(v)));
bindDirect("hausEK", v => state.zukunft.haus.eigenkapital = v);
bindDirect("hausNK", v => state.zukunft.haus.nebenkosten = v);
document.getElementById("zuTarget").addEventListener("change", e => {
  if (e.target.value) state.zukunft.targetYM = e.target.value;
  if (document.activeElement === e.target) {
    e.target.addEventListener("blur", () => render(), { once: true });
    return;
  }
  render();
});
bindDirect("retYears", v => state.alters.years = Math.max(1, Math.round(v)));
bindDirect("versWohnflaeche", v => state.versicherungen.wohnflaeche = Math.max(0, Math.round(v)));
bindDirect("retZins", v => state.alters.zins = v);
bindDirect("retInfl", v => state.alters.inflation = v);

/* ---------- Drag & Drop: Zeilen per Griff sortieren ---------- */
let dragSrc = null;
document.addEventListener("mousedown", e => {
  const h = e.target.closest(".drag-handle");
  if (h) { const tr = h.closest("tr"); if (tr) tr.draggable = true; }
});
document.addEventListener("mouseup", () => {
  document.querySelectorAll('tr[draggable="true"]').forEach(tr => { if (tr !== dragSrc) tr.draggable = false; });
});
document.addEventListener("dragstart", e => {
  const tr = e.target.closest ? e.target.closest("tr") : null;
  if (tr && tr.draggable) {
    dragSrc = tr;
    tr.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", ""); } catch (err) { }
  }
});
document.addEventListener("dragover", e => {
  if (!dragSrc) return;
  const tr = e.target.closest("tr");
  if (tr && tr !== dragSrc && tr.parentElement === dragSrc.parentElement && tr.parentElement.tagName === "TBODY") {
    e.preventDefault();
    const rect = tr.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    tr.parentElement.insertBefore(dragSrc, after ? tr.nextSibling : tr);
  }
});
document.addEventListener("drop", e => { if (dragSrc) e.preventDefault(); });
document.addEventListener("dragend", () => {
  if (!dragSrc) return;
  const tbody = dragSrc.parentElement;
  const ref = dragSrc.querySelector("[data-list]");
  dragSrc.classList.remove("dragging");
  dragSrc.draggable = false;
  const src = dragSrc; dragSrc = null;
  if (!ref || !tbody) return;
  const listName = ref.dataset.list;
  let arr;
  if (listName === "vacpos") {
    const v = state.urlaub.vacations.find(x => x.id === ref.dataset.vac);
    arr = v && v.positions;
  } else arr = listRef(listName);
  if (!arr) return;
  // Neue Reihenfolge aus dem DOM ablesen (nur Zeilen dieses tbody)
  const orderIds = [...tbody.querySelectorAll("tr")].map(r => {
    const el = r.querySelector("[data-list]");
    return el ? el.dataset.id : null;
  }).filter(Boolean);
  const idset = new Set(orderIds);
  const subset = orderIds.map(id => arr.find(x => x.id === id)).filter(Boolean);
  let k = 0;
  for (let i = 0; i < arr.length; i++) if (idset.has(arr[i].id)) arr[i] = subset[k++];
  render();
});

/* Kategorie-Feld in Kostentabellen: als Text mit datalist – nachträglich einfügen */
document.addEventListener("dblclick", e => {
  // Doppelklick auf Kategorienamen: umbenennen
  const h = e.target.closest(".cat-name");
  if (!h) return;
  const oldName = h.textContent;
  const nn = prompt("Kategorie umbenennen:", oldName);
  if (nn && nn !== oldName) {
    state.costs.forEach(c => { if (c.category === oldName) c.category = nn; });
    const i = state.categories.indexOf(oldName);
    if (i >= 0) state.categories[i] = nn; else state.categories.push(nn);
    render();
  }
});

/* ============================================================
   Autosave in JSON-Datei (File System Access API, Chrome/Edge)
   Datei im Google-Drive-Ordner wählen → automatische Cloud-Sync
   ============================================================ */
let autosaveHandle = null, autosaveTimer = null, autosaveState = "aus"; // aus | aktiv | reconnect
function autosaveSupported() { return typeof window !== "undefined" && "showSaveFilePicker" in window; }

function setAutosaveUI() {
  const btn = document.getElementById("autosaveBtn");
  if (!btn) return;
  btn.classList.toggle("active-save", autosaveState === "aktiv");
  btn.innerHTML = autosaveState === "aktiv" ? "● Autosave aktiv"
    : autosaveState === "reconnect" ? "◌ Autosave neu verbinden"
    : "○ Autosave einrichten";
  btn.title = autosaveState === "aktiv"
    ? "Speichert nach jeder Änderung automatisch in: " + (autosaveHandle && autosaveHandle.name || "Datei")
    : "Einmalig eine JSON-Datei wählen (z. B. im Google-Drive-Ordner) – danach wird jede Änderung automatisch dort gespeichert.";
}

function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("finanzplaner", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(k, v) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(v, k);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) { /* IndexedDB nicht verfügbar – Autosave gilt dann nur für diese Sitzung */ }
}
async function idbGet(k) {
  try {
    const db = await idbOpen();
    return await new Promise((res, rej) => {
      const rq = db.transaction("kv").objectStore("kv").get(k);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  } catch (e) { return null; }
}

async function connectAutosave() {
  if (!autosaveSupported()) {
    alert("Automatisches Speichern in eine Datei unterstützt dein Browser leider nicht.\nBitte Chrome oder Edge verwenden – oder weiterhin den Export-Button nutzen.");
    return;
  }
  try {
    // Fall 1: Handle aus früherer Sitzung – nur Berechtigung erneuern
    if (autosaveState === "reconnect" && autosaveHandle) {
      const p = await autosaveHandle.requestPermission({ mode: "readwrite" });
      if (p === "granted") { autosaveState = "aktiv"; setAutosaveUI(); writeAutosave(); return; }
    }
    // Fall 2: Datei (neu) wählen
    const h = await window.showSaveFilePicker({
      suggestedName: "finanzplan-daten.json",
      types: [{ description: "JSON-Datei", accept: { "application/json": [".json"] } }]
    });
    // Enthält die Datei bereits Daten? Dann anbieten, sie zu laden.
    try {
      const f = await h.getFile();
      if (f.size > 0) {
        const data = JSON.parse(await f.text());
        if (data && data.incomes && JSON.stringify(data) !== JSON.stringify(state) &&
            confirm("Die gewählte Datei enthält bereits Finanzplan-Daten.\n\nOK = Daten aus der Datei laden\nAbbrechen = Datei mit den aktuellen Daten überschreiben")) {
          state = data; migrate();
        }
      }
    } catch (e) { /* neue oder fremde Datei – wird überschrieben */ }
    autosaveHandle = h;
    autosaveState = "aktiv";
    await idbSet("autosaveHandle", h);
    setAutosaveUI();
    render();
    writeAutosave();
  } catch (e) { /* Auswahl abgebrochen */ }
}

async function writeAutosave() {
  if (autosaveState !== "aktiv" || !autosaveHandle) return;
  try {
    const w = await autosaveHandle.createWritable();
    await w.write(JSON.stringify(state, null, 2));
    await w.close();
  } catch (e) {
    autosaveState = "reconnect";
    setAutosaveUI();
  }
}
function scheduleAutosave() {
  if (autosaveState !== "aktiv") return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(writeAutosave, 800); // gebündelt speichern
}
async function restoreAutosave() {
  setAutosaveUI();
  if (!autosaveSupported() || typeof indexedDB === "undefined") return;
  const h = await idbGet("autosaveHandle");
  if (!h) return;
  autosaveHandle = h;
  try {
    const p = await h.queryPermission({ mode: "readwrite" });
    autosaveState = p === "granted" ? "aktiv" : "reconnect";
  } catch (e) { autosaveState = "reconnect"; }
  setAutosaveUI();
}

/* ============================================================
   Cloud-Sync über GitHub (Contents-API, privates Daten-Repo)
   - Daten liegen als JSON-Datei im Repo, Zugriff per Fine-grained Token
   - "Neuester Stand gewinnt" (state.meta.updatedAt); bei Konflikt wird gefragt
   ============================================================ */
const SYNC_KEY = "finanzplaner_sync_v1";
const sync = { owner: "", repo: "", path: "finanzplan-daten.json", branch: "main", token: "" };
let syncSha = null, syncStatus = "aus", syncMsg = "", syncDirty = false, syncBusy = false, syncTimer = null;

function syncLoadCfg() {
  try { Object.assign(sync, JSON.parse(localStorage.getItem(SYNC_KEY) || "{}")); } catch (e) { /* ignorieren */ }
}
function syncSaveCfg() {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) { /* ignorieren */ }
}
function syncConfigured() { return !!(sync.owner && sync.repo && sync.token); }
function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function b64dec(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function ghUrl() {
  return "https://api.github.com/repos/" + encodeURIComponent(sync.owner) + "/" + encodeURIComponent(sync.repo) +
    "/contents/" + sync.path.split("/").map(encodeURIComponent).join("/");
}
function ghHeaders() {
  return { "Authorization": "Bearer " + sync.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}
function setSyncStatus(st, msg) {
  syncStatus = st; syncMsg = msg || "";
  const b = document.getElementById("syncBtn"), t = document.getElementById("syncState");
  const label = { aus: "☁ Sync aus", ok: "☁ ✓", busy: "☁ …", offline: "☁ offline", fehler: "☁ ⚠" }[st] || "☁";
  if (b) { b.textContent = label; b.className = "btn" + (st === "ok" ? " active-save" : st === "fehler" ? " danger" : ""); b.title = msg || label; }
  if (t) t.textContent = { aus: "Nicht verbunden", ok: "Synchron", busy: "Synchronisiere …", offline: "Offline – Änderungen werden später gesendet", fehler: "Fehler" }[st] + (msg ? " – " + msg : "");
}

async function ghGet() {
  const r = await fetch(ghUrl() + "?ref=" + encodeURIComponent(sync.branch) + "&t=" + Date.now(), { headers: ghHeaders(), cache: "no-store" });
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error("GitHub " + r.status + (r.status === 401 ? " (Token ungültig/abgelaufen)" : r.status === 403 ? " (keine Berechtigung/Rate-Limit)" : ""));
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(b64dec(j.content)) };
}
async function ghPut() {
  const body = { message: "Finanzplaner-Update " + new Date().toISOString(), content: b64enc(JSON.stringify(state, null, 2)), branch: sync.branch };
  if (syncSha) body.sha = syncSha;
  const r = await fetch(ghUrl(), { method: "PUT", headers: { ...ghHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw new Error("GitHub " + r.status + (r.status === 404 ? " (Repo/Branch nicht gefunden oder Token ohne Zugriff)" : r.status === 401 ? " (Token ungültig)" : ""));
  syncSha = (await r.json()).content.sha;
  return { ok: true };
}
function applyRemote(data, sha) {
  state = data; migrate(); syncSha = sha; lastSer = serState(); persistLocal(); render();
}
function isEmptyState(s) {
  return !(s.incomes && s.incomes.length) && !(s.costs && s.costs.length) && !(s.urlaub && s.urlaub.vacations && s.urlaub.vacations.length);
}

/* Holt den Cloud-Stand und gleicht ihn ab. first = erste Verbindung dieses Geräts */
async function syncPull(first) {
  if (!syncConfigured() || syncBusy) return;
  syncBusy = true; setSyncStatus("busy");
  try {
    const rem = await ghGet();
    if (rem.missing) { syncSha = null; syncDirty = true; await syncPushNow(true); return; }
    const rT = (rem.data.meta && rem.data.meta.updatedAt) || 0, lT = (state.meta && state.meta.updatedAt) || 0;
    syncSha = rem.sha;
    if (rT === lT) { syncDirty = false; setSyncStatus("ok"); return; }
    if (rT > lT) {
      if (syncDirty && !isEmptyState(state) && !confirm("Lokale, noch nicht gesendete Änderungen UND neuere Cloud-Daten vorhanden.\n\nOK = Cloud-Stand laden (lokale Änderungen gehen verloren)\nAbbrechen = lokalen Stand behalten und Cloud überschreiben")) {
        await syncPushNow(true); return;
      }
      applyRemote(rem.data, rem.sha); syncDirty = false; setSyncStatus("ok"); return;
    }
    // lokal neuer
    if (first && !isEmptyState(state) && !confirm("In der Cloud liegen bereits Daten.\n\nOK = Lokale Daten dieses Geräts in die Cloud schreiben (Cloud wird überschrieben)\nAbbrechen = Cloud-Daten laden (lokale Daten dieses Geräts gehen verloren)")) {
      applyRemote(rem.data, rem.sha); syncDirty = false; setSyncStatus("ok"); return;
    }
    syncDirty = true; await syncPushNow(true);
  } catch (e) {
    setSyncStatus(navigator.onLine === false || /Failed to fetch|NetworkError|Load failed/i.test(String(e)) ? "offline" : "fehler", e.message);
  } finally { syncBusy = false; }
}

async function syncPushNow(inside) {
  if (!syncConfigured()) return;
  if (syncBusy && !inside) return;
  if (!inside) syncBusy = true;
  setSyncStatus("busy");
  try {
    let res = await ghPut();
    if (res.conflict) {                       // Cloud wurde zwischenzeitlich geändert
      const rem = await ghGet();
      if (!rem.missing) {
        const rT = (rem.data.meta && rem.data.meta.updatedAt) || 0, lT = (state.meta && state.meta.updatedAt) || 0;
        if (rT > lT && confirm("Die Cloud-Daten wurden auf einem anderen Gerät geändert.\n\nOK = Cloud-Stand laden (lokale Änderungen verwerfen)\nAbbrechen = meinen Stand erzwingen")) {
          applyRemote(rem.data, rem.sha); syncDirty = false; setSyncStatus("ok"); return;
        }
        syncSha = rem.sha;
      } else syncSha = null;
      res = await ghPut();
      if (res.conflict) throw new Error("Konflikt konnte nicht gelöst werden");
    }
    syncDirty = false; setSyncStatus("ok");
  } catch (e) {
    syncDirty = true;
    setSyncStatus(navigator.onLine === false || /Failed to fetch|NetworkError|Load failed/i.test(String(e)) ? "offline" : "fehler", e.message);
  } finally { if (!inside) syncBusy = false; }
}
function scheduleCloudPush() {
  if (!syncConfigured()) return;
  syncDirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { if (!syncBusy) syncPushNow(); else scheduleCloudPush(); }, 1800);
}
async function syncNow() { // manueller Button
  if (!syncConfigured()) { openSettings(); return; }
  if (syncDirty) await syncPushNow(); else await syncPull(false);
}

/* ---------- Einstellungen-Dialog ---------- */
function openSettings() {
  const d = document.getElementById("settingsDlg");
  ["owner", "repo", "path", "branch", "token"].forEach(k => { document.getElementById("sync_" + k).value = sync[k] || ""; });
  document.getElementById("pinState").textContent = localStorage.getItem(PIN_KEY) ? "PIN ist aktiv" : "Keine PIN gesetzt";
  setSyncStatus(syncStatus, syncMsg);
  d.classList.add("open");
}
function closeSettings() { document.getElementById("settingsDlg").classList.remove("open"); }
async function connectSync() {
  const v = k => document.getElementById("sync_" + k).value.trim();
  sync.owner = v("owner"); sync.repo = v("repo"); sync.path = v("path") || "finanzplan-daten.json";
  sync.branch = v("branch") || "main"; sync.token = v("token");
  if (!syncConfigured()) { alert("Bitte GitHub-Benutzer, Repository und Token angeben."); return; }
  syncSaveCfg(); syncSha = null; closeSettings();
  await syncPull(true);
}
function disconnectSync() {
  if (!confirm("Cloud-Sync auf diesem Gerät trennen? (Lokale Daten bleiben erhalten, Token wird entfernt.)")) return;
  sync.token = ""; syncSaveCfg(); syncSha = null; syncDirty = false; setSyncStatus("aus"); closeSettings();
}

/* ============================================================
   PIN-Sperre (reine Oberflächen-Sperre dieses Geräts)
   ============================================================ */
const PIN_KEY = "finanzplaner_pin_v1", LOCK_AFTER_MS = 5 * 60 * 1000;
let hiddenAt = 0;
async function pinHash(pin, salt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function pinAvailable() { return !!(window.crypto && crypto.subtle); }
function showLock(show) {
  document.getElementById("lockScreen").classList.toggle("open", show);
  document.body.classList.toggle("locked", show);
  if (show) { const i = document.getElementById("lockInput"); i.value = ""; document.getElementById("lockErr").textContent = ""; setTimeout(() => i.focus(), 50); }
}
async function tryUnlock() {
  const i = document.getElementById("lockInput");
  try {
    const cfg = JSON.parse(localStorage.getItem(PIN_KEY));
    if ((await pinHash(i.value, cfg.salt)) === cfg.hash) { showLock(false); return; }
  } catch (e) { /* falsch */ }
  document.getElementById("lockErr").textContent = "Falsche PIN"; i.value = "";
}
async function setPin() {
  if (!pinAvailable()) { alert("PIN-Funktion benötigt eine sichere Verbindung (https)."); return; }
  const p = prompt("Neue PIN (mind. 4 Zeichen):");
  if (p == null) return;
  if (p.length < 4) { alert("PIN zu kurz."); return; }
  if (prompt("PIN wiederholen:") !== p) { alert("PINs stimmen nicht überein."); return; }
  const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash: await pinHash(p, salt) }));
  document.getElementById("pinState").textContent = "PIN ist aktiv";
}
function removePin() {
  if (!localStorage.getItem(PIN_KEY)) return;
  if (confirm("PIN-Sperre entfernen?")) { localStorage.removeItem(PIN_KEY); document.getElementById("pinState").textContent = "Keine PIN gesetzt"; }
}
function lockNow() { if (localStorage.getItem(PIN_KEY)) showLock(true); else alert("Es ist noch keine PIN gesetzt (⚙ Einstellungen)."); }

function initCloudAndLock() {
  syncLoadCfg();
  setSyncStatus(syncConfigured() ? "busy" : "aus");
  if (localStorage.getItem(PIN_KEY)) showLock(true);
  document.getElementById("lockInput").addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });
  document.getElementById("lockBtn").addEventListener("click", tryUnlock);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (localStorage.getItem(PIN_KEY) && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) showLock(true);
    if (syncConfigured()) { if (syncDirty) syncPushNow(); else syncPull(false); }
  });
  window.addEventListener("online", () => { if (syncConfigured()) { if (syncDirty) syncPushNow(); else syncPull(false); } });
  if (!autosaveSupported()) { const b = document.getElementById("autosaveRow"); if (b) b.style.display = "none"; }
  if (syncConfigured()) syncPull(false);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* ohne SW weiter nutzbar */ });
  }
}

/* ---------- Init ---------- */
// "Eigenheim & Vorsorge" in den Zukunft-Tab integrieren (Blöcke umziehen)
// Reihenfolge: Vermögensprognose → Sparziel Eigenheim → Hauskauf-Simulation → Altersvorsorge → Budgetplanung → Fixkosten
(function mergeZielePanel() {
  const src = document.getElementById("panel-ziele");
  const dst = document.getElementById("panel-zukunft");
  const anchor = dst ? dst.querySelector('[data-block="zu-budget"]') : null;
  if (src && dst && anchor) {
    const kids = [...src.children];
    const zHome = kids.find(k => k.dataset && k.dataset.block === "z-home");
    const haus = dst.querySelector('[data-block="zu-haus"]');
    if (zHome) dst.insertBefore(zHome, anchor);
    if (haus) dst.insertBefore(haus, anchor);
    kids.filter(k => k !== zHome).forEach(ch => dst.insertBefore(ch, anchor));
    src.remove();
  }
})();
Chart.defaults.color = C.text;
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
load();
render();
restoreAutosave();
initCloudAndLock();
