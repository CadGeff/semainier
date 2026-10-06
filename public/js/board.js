// La planche : grille de la semaine (ou du jour sur écran étroit), ligne « À faire », légende,
// barre d'état, choix de la vue, navigation, et création d'un élément au clic sur une case vide.
// Les vues d'ensemble (mois, « À venir », semaine en liste) sont fabriquées par views.js.

import {
  pad,
  ds,
  parse,
  addDays,
  dow,
  mondayOf,
  isoWeek,
  toMin,
  fromMin,
  DN,
  recurText,
  occurs,
} from "./recurrence.js";
import { CATS, LAST } from "./items.js";
import { layout } from "./layout.js";
import { monthWeeks, addMonths, blockMinutes, isRecurring } from "./month.js";
import { overviewHtml } from "./views.js";
import { Store } from "./store.js";
import { carriedFor, carryDay, isCarriedFrom, taskDone } from "./carry.js";
import { state, catLabel, toggleDone, todayDate } from "./state.js";
import { $, esc, applyGeometry, anyDialogOpen, selectorsOf, CHECK } from "./dom.js";
import { openDetail } from "./detail.js";
import { openForm } from "./form.js";
import { openCats } from "./categories.js";
import { resetDemo } from "./menu.js";

const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
/** « mar. 29 » : jour prévu d'une tâche reportée. */
const fmtFrom = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
/** Plage horaire par défaut, élargie si un élément déborde. */
const DAY_START = 7;
const DAY_END = 22;

/** Préférences d'affichage mémorisées sur l'appareil. */
const VIEW_KEY = "semainier.view";
const UPCOMING_KEY = "semainier.upcoming";

const board = $("board");
const overview = $("overview");
const narrowMq = matchMedia("(max-width: 760px)");
const canHover = matchMedia("(hover: hover) and (pointer: fine)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
/** Écran étroit : la grille horaire n'affiche qu'un jour à la fois. */
export const narrow = () => narrowMq.matches;

/**
 * Disposition affichée, déduite de la vue choisie et de la largeur de l'écran :
 * « grid » (grille horaire : la semaine, ou un jour sur écran étroit), « list » (semaine en
 * liste, écran étroit seulement) ou « month ».
 * @returns {"grid"|"list"|"month"}
 */
function layoutOf() {
  if (state.view === "month") return "month";
  return narrow() && state.view === "week" ? "list" : "grid";
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : la préférence ne vaut que pour cette session */
  }
}

/**
 * @param {"day"|"week"|"month"} view
 * @param {boolean} [keep]  mémoriser ce choix sur l'appareil (non pour un simple détour par une journée)
 */
function setView(view, keep = true) {
  state.view = view;
  state.pick = null;
  state.upcomingMore = false;
  if (keep) remember(VIEW_KEY, view);
  render();
}

/**
 * Le jour `day` est-il dans la période affichée ? Sur écran étroit, la réponse est toujours oui :
 * on ne déplace pas l'affichage sous le doigt de quelqu'un qui vient d'ajouter un élément.
 * @param {string} day "AAAA-MM-JJ"
 */
export function isShown(day) {
  if (narrow()) return true;
  if (layoutOf() !== "month") return ds(mondayOf(parse(day))) === ds(mondayOf(state.sel));
  const weeks = monthWeeks(state.sel);
  return day >= ds(weeks[0][0]) && day <= ds(weeks[weeks.length - 1][6]);
}

/** Ce que dit le pied de page, selon ce qu'un clic fait dans la vue affichée. */
const HINTS = {
  grid: "Clique sur une case vide de la grille pour bloquer un créneau à cette heure.",
  month: "Clique sur un jour pour y ajouter un élément, sur un élément pour l'ouvrir.",
  "month-narrow": "Touche un jour pour voir ce qu'il contient.",
  list: "Touche une date pour ouvrir la journée.",
};

/**
 * Repère l'élément du planning qui a le focus, pour le lui rendre après un rendu qui remplace le HTML.
 * @returns {string | null} sélecteur CSS de l'élément équivalent dans le nouveau rendu
 */
function focusKey() {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !a.closest("#board, #overview, #legend, #strip")) return null;
  return selectorsOf(a)[0] || null;
}
const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 52;
const occsFor = (day) => state.items.filter((it) => occurs(it, day));

// ------------------------------------------------------------------ Rendu
/** Barre d'état : avancement des tâches du jour, bandeau de démo. */
function renderStatus() {
  const today = ds(new Date());
  // Les tâches reportées à aujourd'hui comptent : elles sont à faire aujourd'hui.
  const tasks = [...occsFor(today).filter((it) => it.kind === "task"), ...carriedFor(state.items, today, today)];
  const done = tasks.filter((it) => taskDone(it, today)).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  let h = "";
  if (!state.loaded) h += `<span class="status">Chargement du planning…</span>`;
  else if (tasks.length)
    h += `<span class="pill">Tâches du jour : ${done}/${tasks.length} <span class="meter" aria-hidden="true"><i data-pct="${pct}"></i></span></span>`;
  else h += `<span class="pill">Aucune tâche aujourd'hui</span>`;
  if (Store.mode === "demo")
    h += `<span class="demo"><span class="demo-tag">Démo</span> Données d'exemple, enregistrées dans ce navigateur uniquement. <button class="linkbtn" id="resetDemo">Réinitialiser</button></span>`;
  const bar = $("bar");
  bar.innerHTML = h;
  applyGeometry(bar);
  const r = $("resetDemo");
  if (r) r.onclick = resetDemo;
}

export function render() {
  // Le détail d'un jour n'a de sens que pour le jour sélectionné.
  if (state.pick && state.pick !== ds(state.sel)) state.pick = null;
  const focused = focusKey();
  const view = layoutOf();
  $("app").dataset.layout = view;
  $("hint").textContent = HINTS[view === "month" && narrow() ? "month-narrow" : view];
  const up = $("upToggle");
  up.hidden = view !== "month" || narrow();
  up.setAttribute("aria-pressed", String(state.upcomingOpen));
  // Sur grand écran, « Jour » n'existe pas : la grille de la semaine en tient lieu.
  const pressed = view === "month" ? "month" : view === "list" || !narrow() ? "week" : "day";
  for (const b of $("viewSeg").querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.view === pressed));
  board.hidden = view !== "grid";
  overview.hidden = view === "grid";

  const mon = mondayOf(state.sel);
  const week = [...Array(7)].map((_, i) => addDays(mon, i));
  if (view === "month") {
    const name = fmtMonth.format(state.sel);
    $("wk").innerHTML = `<b>${esc(name[0].toUpperCase() + name.slice(1))}</b>`;
  } else {
    const sun = week[6];
    $("wk").innerHTML =
      `<b>S${isoWeek(mon)}</b> · ${fmtShort.format(mon)} → ${fmtShort.format(sun)} ${sun.getFullYear()}`;
  }

  if (view === "grid") renderGrid(week);
  else {
    const month = state.sel.getMonth();
    const days =
      view === "list"
        ? week
        : monthWeeks(state.sel)
            .flat()
            .filter((d) => d.getMonth() === month);
    renderLegend(blockMinutes(state.items, days.map(ds)), view === "list" ? "cette semaine" : "ce mois");
    board.innerHTML = "";
    overview.innerHTML = overviewHtml(view, narrow());
  }
  renderStatus();
  if (focused) /** @type {HTMLElement | null} */ (document.querySelector(focused))?.focus({ preventScroll: true });
}

/** Grille horaire : les sept jours de la semaine, ou le jour sélectionné sur écran étroit. */
function renderGrid(week) {
  const days = narrow() ? [state.sel] : week;
  const todayS = ds(new Date());
  const selS = ds(state.sel);
  overview.innerHTML = "";

  $("strip").innerHTML = week
    .map((d) => {
      const s = ds(d);
      const cls = s === todayS ? "today" : s < todayS ? "past" : "";
      return `<button data-go="${s}" aria-pressed="${s === selS}" class="${cls}"><small>${DN[dow(d)]}</small><span>${d.getDate()}</span></button>`;
    })
    .join("");

  let startH = DAY_START;
  let endH = DAY_END;
  const perDay = days.map((d) => {
    const s = ds(d);
    const occ = occsFor(s);
    const timed = occ.filter((it) => it.from && it.to).map((it) => ({ ...it }));
    for (const e of timed) {
      startH = Math.min(startH, Math.floor(toMin(e.from) / 60));
      endH = Math.max(endH, Math.ceil(toMin(e.to) / 60));
    }
    const when = s === todayS ? "today" : s < todayS ? "past" : "";
    const cls = `${when}${dow(d) >= 5 ? " weekend" : ""}`;
    const untimed = occ.filter((it) => !(it.from && it.to));
    // Tâches reportées : toujours sans heure, pour ne rien bloquer dans la grille.
    return { d, s, when, cls, timed: layout(timed), untimed, carried: carriedFor(state.items, s, todayS) };
  });
  endH = Math.min(endH, 24);
  renderLegend(
    blockMinutes(
      state.items,
      perDay.map((p) => p.s),
    ),
    days.length === 1 ? "ce jour" : "cette semaine",
  );

  const dim = (it) => (state.focusCat && it.cat !== state.focusCat ? " dim" : "");
  const HOUR = hourPx();
  const y = (m) => ((m - startH * 60) / 60) * HOUR;
  board.style.setProperty("--n", String(days.length));
  board.style.setProperty("--hours", String(endH - startH));

  let h = `<div class="hd gut" aria-hidden="true"></div>`;
  for (const p of perDay)
    h += `<div class="hd day ${p.cls}"><span class="dn">${DN[dow(p.d)]}</span><span class="dd">${p.d.getDate()}</span></div>`;

  // Ligne « À faire » : tâches sans heure.
  h += `<div class="todo gut"><span>À faire</span></div>`;
  for (const p of perDay) {
    h += `<div class="todo day ${p.cls}"><ul>`;
    if (!p.untimed.length && !p.carried.length) h += `<li class="empty">—</li>`;
    for (const it of p.carried) {
      const dn = taskDone(it, p.s);
      const from = fmtFrom.format(parse(carryDay(it)));
      h += `<li class="carried${dn ? " done" : ""}${dim(it)}" data-cat="${esc(it.cat || "gris")}">
        <button class="chk" role="checkbox" aria-checked="${dn}" aria-label="Marquer « ${esc(it.title)} » comme faite, ${dn ? "prévue" : "reportée depuis"} ${esc(from)}" data-toggle="${esc(it.id)}" data-day="${p.s}">${CHECK}</button>
        <span class="t-body">
          <button class="t-title" data-open="${esc(it.id)}" data-day="${p.s}">${esc(it.title)}</button>
          <span class="from">${dn ? "prévue" : "depuis"} ${esc(from)}</span>
        </span>
      </li>`;
    }
    for (const it of p.untimed) {
      const dn = taskDone(it, p.s);
      h += `<li class="${dn ? "done" : ""}${dim(it)}" data-cat="${esc(it.cat || "gris")}">
        <button class="chk" role="checkbox" aria-checked="${dn}" aria-label="Marquer « ${esc(it.title)} » comme faite" data-toggle="${esc(it.id)}" data-day="${p.s}">${CHECK}</button>
        <button class="t-title" data-open="${esc(it.id)}" data-day="${p.s}">${esc(it.title)}</button>
        ${isRecurring(it) ? `<span class="rec" title="${esc(recurText(it))}">↻</span>` : ""}
        ${isCarriedFrom(it, p.s, todayS) ? `<span class="rec" role="img" aria-label="Reportée à aujourd'hui" title="Non faite : reportée à aujourd'hui">↷</span>` : ""}
      </li>`;
    }
    h += `</ul></div>`;
  }

  // Grille horaire.
  h += `<div class="col gut" aria-hidden="true">`;
  for (let k = startH; k < endH; k++) h += `<div class="hl" data-top="${(k - startH) * HOUR + 4}">${pad(k)}:00</div>`;
  h += `</div>`;
  const now = new Date();
  const nowM = now.getHours() * 60 + now.getMinutes();
  for (const p of perDay) {
    h += `<div class="col day ${p.cls}" data-col="${p.s}">`;
    if (p.when === "today" && nowM >= startH * 60 && nowM <= endH * 60)
      h += `<div class="now" data-top="${y(nowM)}"></div>`;
    for (const e of p.timed) {
      const s = toMin(e.from);
      const en = Math.max(toMin(e.to), s + 15);
      const top = y(s);
      const ht = Math.max(((en - s) / 60) * HOUR - 2, 20);
      const dn = e.kind === "task" && taskDone(e, p.s);
      const moved = isCarriedFrom(e, p.s, todayS);
      const tip = `${e.title} · ${e.from}–${e.to} · ${catLabel(e.cat)}`;
      h += `<div class="ev ${e.kind === "task" ? "task" : "block"}${ht < 40 ? " short" : ""}${dn ? " done" : ""}${dim(e)}" role="button" tabindex="0"
        data-open="${esc(e.id)}" data-day="${p.s}" data-cat="${esc(e.cat || "bleu")}" title="${esc(tip)}"
        data-top="${top + 1}" data-height="${ht}" data-lane="${e.lane}" data-lanes="${e.lanes || 1}"
        aria-label="${esc(e.title)}, ${esc(e.from)} à ${esc(e.to)}${moved ? ", reportée à aujourd'hui" : ""}">
        ${e.kind === "task" ? `<button class="chk" role="checkbox" aria-checked="${dn}" aria-label="Marquer comme faite" data-toggle="${esc(e.id)}" data-day="${p.s}">${CHECK}</button>` : ""}
        <span class="bd"><span class="tt">${esc(e.title)}</span><span class="tm">${esc(e.from)}–${esc(e.to)}${isRecurring(e) ? " ↻" : ""}${moved ? " ↷" : ""}</span></span>
      </div>`;
    }
    h += `</div>`;
  }
  board.innerHTML = h;
  applyGeometry(board);
  board.dataset.start = String(startH);
}

/**
 * Légende : temps bloqué par catégorie ; un clic met une catégorie en avant, un second annule.
 * @param {Record<string, number>} mins  minutes de créneaux par catégorie sur la période affichée
 * @param {string} period  « ce jour », « cette semaine » ou « ce mois »
 */
function renderLegend(mins, period) {
  const fmtH = (m) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (!h) return `${r} min`;
    return r ? `${h} h ${pad(r)}` : `${h} h`;
  };
  $("legend").innerHTML = `${CATS.map(
    (c) => `
      <button class="cat-item" data-cat="${c}" aria-pressed="${state.focusCat === c}"
        title="${esc(catLabel(c))} : ${mins[c] ? `${fmtH(mins[c])} de créneaux ${period}` : `aucun créneau ${period}`}">
        <span class="swatch" aria-hidden="true"></span><b>${esc(catLabel(c))}</b>${mins[c] ? `<span class="hrs">${fmtH(mins[c])}</span>` : ""}
      </button>`,
  ).join("")}<button class="linkbtn" id="renameCats">Renommer</button>`;
}

/** Amène la ligne « maintenant » dans le tiers haut de l'écran si elle n'est pas visible. */
export function scrollToNow() {
  const n = board.querySelector(".now");
  if (!n) return;
  const r = n.getBoundingClientRect();
  if (r.top > 90 && r.top < innerHeight - 90) return;
  window.scrollTo({
    top: Math.max(0, r.top + scrollY - innerHeight / 3),
    behavior: reducedMotion.matches ? "auto" : "smooth",
  });
}

// ------------------------------------------------------------ Navigation
/** Avance ou recule d'une période : un jour, une semaine ou un mois selon la vue. */
function step(dir) {
  const view = layoutOf();
  if (view === "month") state.sel = addMonths(state.sel, dir);
  else state.sel = addDays(state.sel, dir * (view === "grid" && narrow() ? 1 : 7));
  state.pick = null;
  render();
}
export const goPrev = () => step(-1);
export const goNext = () => step(1);
export const goToday = () => {
  state.sel = todayDate();
  state.pick = null;
  render();
  scrollToNow();
};
export const newItem = () => openForm(null, { date: ds(state.sel), kind: "task" });

/** Quart d'heure sous le pointeur dans une colonne ; créneau d'une heure par défaut. */
function slotAt(col, clientY) {
  const r = col.getBoundingClientRect();
  const m = Math.floor(((clientY - r.top) / hourPx()) * 4) * 15 + Number(board.dataset.start) * 60;
  const from = Math.max(0, Math.min(m, 23 * 60));
  return { from, to: Math.min(from + 60, LAST) };
}

export function initBoard() {
  // Vue et panneau choisis la dernière fois sur cet appareil.
  try {
    const v = localStorage.getItem(VIEW_KEY);
    state.view = v === "day" || v === "week" || v === "month" ? v : narrow() ? "day" : "week";
    state.upcomingOpen = localStorage.getItem(UPCOMING_KEY) === "1";
  } catch {
    state.view = narrow() ? "day" : "week";
  }

  board.addEventListener("click", (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const t = target.closest("[data-toggle]");
    if (t instanceof HTMLElement) {
      ev.stopPropagation();
      toggleDone(t.dataset.toggle, t.dataset.day);
      return;
    }
    const o = target.closest("[data-open]");
    if (o instanceof HTMLElement) return openDetail(o.dataset.open, o.dataset.day);
    const c = target.closest(".col.day");
    if (c instanceof HTMLElement) {
      const { from, to } = slotAt(c, ev.clientY);
      openForm(null, { date: c.dataset.col, from: fromMin(from), to: fromMin(to), kind: "block" });
    }
  });
  board.addEventListener("keydown", (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    if ((ev.key === "Enter" || ev.key === " ") && target.matches(".ev")) {
      ev.preventDefault();
      openDetail(target.dataset.open, target.dataset.day);
    }
  });

  // Aperçu du créneau sous la souris (écrans avec survol uniquement).
  const ghost = document.createElement("div");
  ghost.className = "ghost";
  ghost.setAttribute("aria-hidden", "true");
  board.addEventListener("mousemove", (ev) => {
    if (!canHover.matches) return;
    const target = /** @type {HTMLElement} */ (ev.target);
    const c = target.closest(".col.day");
    if (!c || target.closest(".ev")) return ghost.remove();
    const { from, to } = slotAt(c, ev.clientY);
    if (ghost.parentNode !== c) c.appendChild(ghost);
    const HOUR = hourPx();
    const start = Number(board.dataset.start) * 60;
    ghost.style.top = `${((from - start) / 60) * HOUR + 1}px`;
    ghost.style.height = `${((to - from) / 60) * HOUR - 2}px`;
    ghost.textContent = `${fromMin(from)} – ${fromMin(to)}`;
  });
  board.addEventListener("mouseleave", () => ghost.remove());

  // Vues d'ensemble : mois, « À venir », semaine en liste.
  overview.addEventListener("click", (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const hit = (/** @type {string} */ attr) => {
      const n = target.closest(`[data-${attr}]`);
      return n instanceof HTMLElement ? n : null;
    };
    const t = hit("toggle");
    if (t) return void toggleDone(t.dataset.toggle, t.dataset.day);
    const o = hit("open");
    if (o) return openDetail(o.dataset.open, o.dataset.day);
    if (hit("more")) {
      state.upcomingMore = true;
      return render();
    }
    const p = hit("pick");
    if (p) {
      // Un second appui sur le même jour, ou « Fermer », revient à la liste « À venir ».
      const day = p.dataset.pick;
      state.pick = day && day !== state.pick ? day : null;
      if (state.pick) state.sel = parse(state.pick);
      render();
      overview
        .querySelector(".dayp")
        ?.scrollIntoView({ block: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
      return;
    }
    const g = hit("goto");
    if (g) {
      // Ouvrir une journée : la grille horaire, sur ce jour. Un détour : la vue mémorisée ne change pas.
      state.sel = parse(g.dataset.goto);
      setView(narrow() ? "day" : "week", false);
      window.scrollTo({ top: 0 });
      return;
    }
    // Toute la puce ouvre le détail, pas seulement son titre.
    const c = target.closest(".chip")?.querySelector("[data-open]");
    if (c instanceof HTMLElement) return openDetail(c.dataset.open, c.dataset.day);
    const a = hit("add");
    if (a) openForm(null, { date: a.dataset.add, kind: "task" });
  });

  $("upToggle").onclick = () => {
    state.upcomingOpen = !state.upcomingOpen;
    remember(UPCOMING_KEY, state.upcomingOpen ? "1" : "0");
    render();
  };

  $("viewSeg").addEventListener("click", (ev) => {
    const b = /** @type {HTMLElement} */ (ev.target).closest("[data-view]");
    if (b instanceof HTMLElement) setView(/** @type {"day"|"week"|"month"} */ (b.dataset.view));
  });

  $("legend").addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest("#renameCats")) return openCats();
    const b = target.closest("[data-cat]");
    if (!(b instanceof HTMLElement)) return;
    state.focusCat = state.focusCat === b.dataset.cat ? null : b.dataset.cat;
    render();
  });
  $("strip").addEventListener("click", (ev) => {
    const b = /** @type {HTMLElement} */ (ev.target).closest("[data-go]");
    if (b instanceof HTMLElement) {
      state.sel = parse(b.dataset.go);
      render();
    }
  });
  $("prev").onclick = goPrev;
  $("next").onclick = goNext;
  $("today").onclick = goToday;
  $("add").onclick = newItem;
  narrowMq.addEventListener("change", () => render());
  // Toutes les minutes : ligne de l'heure et passage à minuit, sauf si une fenêtre est ouverte.
  setInterval(() => {
    if (state.loaded && !anyDialogOpen()) render();
  }, 60_000);
}
