// Vues d'ensemble : le mois (grille, ou calendrier compact sur écran étroit), la liste
// « À venir » et la semaine en liste. Ce module ne fait que fabriquer le HTML à partir de
// l'état ; les clics sont traités par board.js, qui pose ce HTML dans la page.

import { ds, parse, addDays, dow, mondayOf, isoWeek, DN, DL, recurText } from "./recurrence.js";
import { taskDone } from "./carry.js";
import {
  monthWeeks,
  dayEntries,
  isRecurring,
  upcoming,
  weeksAhead,
  weekLabel,
  CELL_MAX,
  UPCOMING_DAYS,
  UPCOMING_SHORT_DAYS,
} from "./month.js";
import { state, catLabel } from "./state.js";
import { esc, CHECK } from "./dom.js";

/** @import { Item } from "./items.js" */

const fmtLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtMonthShort = new Intl.DateTimeFormat("fr-FR", { month: "short" });

const fmtMonthLong = new Intl.DateTimeFormat("fr-FR", { month: "long" });
const dim = (/** @type {Item} */ it) => (state.focusCat && it.cat !== state.focusCat ? " dim" : "");
const when = (/** @type {string} */ s, /** @type {string} */ today) =>
  s === today ? " today" : s < today ? " past" : "";
const weekend = (/** @type {Date} */ d) => (dow(d) >= 5 ? " weekend" : "");

/** Infobulle : titre, horaire et catégorie. */
const tip = (/** @type {Item} */ it) =>
  `${it.title}${it.from ? ` · ${it.from}–${it.to}` : ""} · ${catLabel(it.cat)}${isRecurring(it) ? ` · ${recurText(it)}` : ""}`;

/**
 * Un élément écrit en toutes lettres : coup de surligneur pour un créneau, case à cocher pour une tâche.
 * @param {Item} it @param {string} day
 * @param {{ time?: boolean, carried?: boolean }} [opts]  time : afficher l'heure de début
 */
function chip(it, day, { time = false, carried = false } = {}) {
  const done = it.kind === "task" && taskDone(it, day);
  const box =
    it.kind === "task"
      ? `<button class="chk" role="checkbox" aria-checked="${done}" aria-label="Marquer « ${esc(it.title)} » comme faite" data-toggle="${esc(it.id)}" data-day="${day}">${CHECK}</button>`
      : "";
  const marks = `${time && it.from ? `<span class="tm">${esc(it.from)}</span>` : ""}${
    isRecurring(it) ? `<span class="rec" aria-hidden="true">↻</span>` : ""
  }${carried ? `<span class="rec" role="img" aria-label="${done ? "Faite après report" : "Reportée à aujourd'hui"}" title="${done ? "Faite après report" : "Non faite : reportée à aujourd'hui"}">↷</span>` : ""}`;
  return `<div class="chip ${it.kind === "task" ? "task" : "block"}${done ? " done" : ""}${dim(it)}" data-cat="${esc(it.cat || "gris")}">${box}<button class="chip-t" data-open="${esc(it.id)}" data-day="${day}" title="${esc(tip(it))}">${esc(it.title)}</button>${marks}</div>`;
}

/**
 * Les habitudes d'un jour, réduites à des marques : un trait par créneau, un rond par tâche
 * (plein quand elle est faite). Un clic ouvre la grille horaire sur ce jour : la journée
 * sur écran étroit, la semaine ailleurs.
 * @param {Item[]} routine @param {string} day @param {boolean} narrow
 */
function routineMarks(routine, day, narrow) {
  if (!routine.length) return "";
  const names = routine.map((it) => it.title).join(", ");
  const marks = routine
    .map((it) => {
      const done = it.kind === "task" && taskDone(it, day);
      return `<i class="${it.kind === "task" ? "task" : "block"}${done ? " done" : ""}${dim(it)}" data-cat="${esc(it.cat || "gris")}"></i>`;
    })
    .join("");
  return `<button class="routine" data-goto="${day}" title="${esc(`Habitudes : ${names}`)}" aria-label="${esc(`Habitudes du ${fmtLong.format(parse(day))} : ${names}. Ouvrir ${narrow ? "la journée" : "la semaine"}`)}">${marks}</button>`;
}

/** Noms des jours en tête de colonne : un repère visuel, chaque jour annonce déjà sa date complète. */
const dayNames = (short = false) =>
  DN.map((n, i) => `<div class="mh${i >= 5 ? " weekend" : ""}" aria-hidden="true">${short ? n[0] : n}</div>`).join("");

/** Grille du mois sur grand écran : éléments ponctuels et séries courtes écrits, habitudes en marques. */
function monthGrid(today) {
  const month = state.sel.getMonth();
  // Première case de la grille : souvent un jour du mois précédent, parfois de l'année précédente.
  const firstCell = ds(mondayOf(new Date(state.sel.getFullYear(), month, 1)));
  let h = `<div class="mh gut" aria-hidden="true"></div>${dayNames()}`;
  for (const week of monthWeeks(state.sel)) {
    h += `<div class="mg" aria-hidden="true">S${isoWeek(week[0])}</div>`;
    for (const d of week) {
      const s = ds(d);
      const { oneOffs, carried, routine } = dayEntries(state.items, s, today);
      const written = [...carried.map((it) => chip(it, s, { carried: true })), ...oneOffs.map((it) => chip(it, s))];
      const shown = written.slice(0, CELL_MAX);
      const more = written.length - shown.length;
      const out = d.getMonth() !== month;
      // Le mois est rappelé au 1er et sur la première case, pour situer les jours hors du mois.
      const mo = d.getDate() === 1 || s === firstCell ? fmtMonthShort.format(d) : "";
      h += `<div class="mc${when(s, today)}${weekend(d)}${out ? " out" : ""}" data-add="${s}">
        <button class="mnum" data-add="${s}" aria-label="Ajouter un élément le ${esc(fmtLong.format(d))}"><span class="num">${d.getDate()}</span>${mo ? `<span class="mo">${esc(mo)}</span>` : ""}</button>
        ${shown.join("")}
        ${more > 0 ? `<button class="more" data-goto="${s}">+ ${more} autre${more > 1 ? "s" : ""}</button>` : ""}
        ${routineMarks(routine, s, false)}
      </div>`;
    }
  }
  return `<div class="month" role="group" aria-label="Mois">${h}</div>`;
}

/** Calendrier compact sur écran étroit : un chiffre et des pastilles par jour. */
function monthMini(today) {
  const month = state.sel.getMonth();
  let h = dayNames(true);
  for (const week of monthWeeks(state.sel)) {
    for (const d of week) {
      const s = ds(d);
      const { oneOffs, carried } = dayEntries(state.items, s, today);
      const all = [...carried, ...oneOffs];
      const dots = all
        .slice(0, CELL_MAX)
        .map((it) => `<i class="${dim(it).trim()}" data-cat="${esc(it.cat || "gris")}"></i>`)
        .join("");
      const label = `${fmtLong.format(d)}${all.length ? `, ${all.length} élément${all.length > 1 ? "s" : ""}` : ""}`;
      h += `<button class="mc${when(s, today)}${weekend(d)}${d.getMonth() !== month ? " out" : ""}" data-pick="${s}" aria-pressed="${state.pick === s}" aria-label="${esc(label)}"><span class="num">${d.getDate()}</span><span class="dots" aria-hidden="true">${dots}</span></button>`;
    }
  }
  return `<div class="month mini" role="group" aria-label="Mois">${h}</div>`;
}

/** Détail du jour touché dans le calendrier compact. */
function dayPanel(day, today) {
  const d = parse(day);
  const { oneOffs, carried, routine } = dayEntries(state.items, day, today);
  const rows = [
    ...carried.map((it) => chip(it, day, { time: true, carried: true })),
    ...oneOffs.map((it) => chip(it, day, { time: true })),
    ...routine.map((it) => chip(it, day, { time: true })),
  ];
  return `<section class="dayp" aria-label="${esc(fmtLong.format(d))}">
    <div class="dayp-head">
      <h2 aria-label="${esc(fmtLong.format(d))}"><b>${d.getDate()}</b> <span>${DL[dow(d)]} · ${esc(fmtMonthLong.format(d))}</span></h2>
      <button class="linkbtn" data-pick="">Fermer</button>
    </div>
    ${rows.join("") || `<p class="nothing">Rien ce jour-là.</p>`}
    <button class="linkbtn open-day" data-goto="${day}">Ouvrir la journée</button>
  </section>`;
}

/**
 * Liste « À venir » : éléments ponctuels et jours des séries courtes des prochaines semaines, regroupés par semaine.
 * @param {string} today @param {boolean} short  s'arrêter à deux semaines, avec un lien pour la suite
 */
function agenda(today, short) {
  const all = upcoming(state.items, today, UPCOMING_DAYS);
  const limit = ds(addDays(parse(today), UPCOMING_SHORT_DAYS));
  const list = short ? all.filter((u) => u.day < limit) : all;
  const thisMonth = parse(today).getMonth();
  let h = "";
  let group = -1;
  for (const u of list) {
    const n = weeksAhead(u.day, today);
    if (n !== group) {
      group = n;
      h += `<h3>${weekLabel(n)}</h3>`;
    }
    const d = parse(u.day);
    const mo = d.getMonth() !== thisMonth ? ` ${fmtMonthShort.format(d)}` : "";
    h += `<div class="up"><span class="ud" title="${esc(fmtLong.format(d))}"><b>${d.getDate()}</b><small>${DN[dow(d)]}${esc(mo)}</small></span>${chip(u.item, u.day, { time: true, carried: u.carried })}</div>`;
  }
  if (!list.length)
    h += `<p class="nothing">${short && all.length ? "Rien dans les deux prochaines semaines." : "Rien de particulier dans les cinq prochaines semaines."}</p>`;
  const hidden = all.length - list.length;
  if (hidden > 0) h += `<button class="linkbtn more-up" data-more="1">Voir la suite (${hidden})</button>`;
  return `<aside class="agenda" aria-label="À venir"><h2>À venir</h2>${h}</aside>`;
}

/** Semaine en liste (écran étroit) : un jour par ligne, sans grille horaire. */
function weekList(today) {
  const mon = mondayOf(state.sel);
  let h = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const s = ds(d);
    const { oneOffs, carried, routine } = dayEntries(state.items, s, today);
    const rows = [
      ...carried.map((it) => chip(it, s, { time: true, carried: true })),
      ...oneOffs.map((it) => chip(it, s, { time: true })),
    ];
    h += `<div class="wr${when(s, today)}${weekend(d)}">
      <button class="wd" data-goto="${s}" aria-label="Ouvrir le ${esc(fmtLong.format(d))}"><small>${DN[dow(d)]}</small><b>${d.getDate()}</b></button>
      <div class="wi">${rows.join("") || `<span class="nothing">Rien de particulier</span>`}${routineMarks(routine, s, true)}</div>
    </div>`;
  }
  return `<div class="wlist" role="group" aria-label="Semaine">${h}</div>`;
}

/**
 * HTML de la vue d'ensemble.
 * @param {"month"|"list"} layout @param {boolean} narrow écran étroit
 */
export function overviewHtml(layout, narrow) {
  const today = ds(new Date());
  if (layout === "list") return weekList(today);
  if (narrow)
    return `${monthMini(today)}${state.pick ? dayPanel(state.pick, today) : agenda(today, !state.upcomingMore)}`;
  return state.upcomingOpen
    ? `<div class="with-side">${monthGrid(today)}${agenda(today, false)}</div>`
    : monthGrid(today);
}
