// Vue mois et liste « À venir » : fonctions pures, sans DOM ni réseau.
// Le mois distingue ce qui sort de l'ordinaire (éléments ponctuels et séries courtes, écrits en
// toutes lettres) des habitudes (séries longues ou sans fin, réduites à une marque de couleur).

import { ds, parse, addDays, mondayOf, occurs, toMin, isShortSeries } from "./recurrence.js";
import { carriedFor, taskDone } from "./carry.js";

/** @import { Item } from "./items.js" */

/** Portée de la liste « À venir », en jours à partir d'aujourd'hui (cinq semaines). */
export const UPCOMING_DAYS = 35;
/** Sur un écran étroit, la liste s'arrête d'abord à deux semaines. */
export const UPCOMING_SHORT_DAYS = 14;
/** Nombre d'éléments écrits en toutes lettres dans une case du mois ; le reste est compté. */
export const CELL_MAX = 3;

/** L'élément revient-il régulièrement ? */
export const isRecurring = (/** @type {Item} */ it) => !!it.recur && it.recur !== "none";
/** Habitude : une série sans fin, ou qui dure plus longtemps qu'une série courte. */
export const isRoutine = (/** @type {Item} */ it) => isRecurring(it) && !isShortSeries(it);

/** Avec heure d'abord, dans l'ordre des heures ; puis sans heure, dans l'ordre de création. */
function byTime(/** @type {Item} */ a, /** @type {Item} */ b) {
  if (a.from && b.from) return a.from < b.from ? -1 : a.from > b.from ? 1 : 0;
  if (a.from) return -1;
  if (b.from) return 1;
  return 0;
}

/**
 * Semaines à afficher pour le mois de `date` : des lundis aux dimanches, de la semaine
 * du 1er à celle du dernier jour (quatre à six semaines).
 * @param {Date} date
 * @returns {Date[][]}
 */
export function monthWeeks(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const weeks = [];
  for (let mon = mondayOf(first); mon <= last; mon = addDays(mon, 7)) {
    weeks.push([...Array(7)].map((_, i) => addDays(mon, i)));
  }
  return weeks;
}

/**
 * Même jour dans un autre mois ; le 31 retombe sur le dernier jour d'un mois plus court.
 * @param {Date} date @param {number} n  nombre de mois à ajouter (négatif pour reculer)
 */
export function addMonths(date, n) {
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

/**
 * Ce qu'un jour contient, trié pour la vue mois.
 * @param {Item[]} items @param {string} day "AAAA-MM-JJ" @param {string} today
 * @returns {{ oneOffs: Item[], carried: Item[], routine: Item[] }}
 *   oneOffs : éléments ponctuels et séries courtes prévus ce jour ; carried : tâches reportées
 *   à ce jour ; routine : habitudes
 */
export function dayEntries(items, day, today) {
  const occ = items.filter((it) => occurs(it, day));
  return {
    oneOffs: occ.filter((it) => !isRoutine(it)).sort(byTime),
    carried: carriedFor(items, day, today),
    routine: occ.filter(isRoutine).sort(byTime),
  };
}

/**
 * Éléments ponctuels et jours des séries courtes à venir, d'aujourd'hui compris jusqu'à `days` jours plus tard.
 * Les tâches déjà faites n'y figurent plus ; les tâches en retard reportées à aujourd'hui y sont.
 * @param {Item[]} items @param {string} today "AAAA-MM-JJ" @param {number} [days]
 * @returns {Array<{ day: string, item: Item, carried: boolean }>}
 */
export function upcoming(items, today, days = UPCOMING_DAYS) {
  const t0 = parse(today);
  const out = [];
  for (const item of carriedFor(items, today, today)) {
    if (!taskDone(item, today)) out.push({ day: today, item, carried: true });
  }
  for (let i = 0; i < days; i++) {
    const day = ds(addDays(t0, i));
    const list = items.filter((it) => !isRoutine(it) && occurs(it, day)).sort(byTime);
    for (const item of list) {
      if (item.kind === "task" && taskDone(item, day)) continue;
      out.push({ day, item, carried: false });
    }
  }
  return out;
}

/**
 * Nombre de semaines entre la semaine d'aujourd'hui et celle de `day` (0 : la même).
 * @param {string} day @param {string} today
 */
export function weeksAhead(day, today) {
  const a = mondayOf(parse(today));
  const b = mondayOf(parse(day));
  // Arrondi : un changement d'heure décale la différence d'une heure.
  return Math.round((b.getTime() - a.getTime()) / (7 * 864e5));
}

/** Titre d'un groupe de la liste « À venir ». @param {number} n semaines d'écart */
export function weekLabel(n) {
  if (n <= 0) return "Cette semaine";
  if (n === 1) return "Semaine prochaine";
  return `Dans ${n} semaines`;
}

/**
 * Minutes de créneaux bloqués par catégorie sur une liste de jours.
 * @param {Item[]} items @param {string[]} days
 * @returns {Record<string, number>}
 */
export function blockMinutes(items, days) {
  /** @type {Record<string, number>} */
  const mins = {};
  for (const day of days) {
    for (const it of items) {
      if (it.kind !== "block" || !it.from || !it.to || !occurs(it, day)) continue;
      mins[it.cat] = (mins[it.cat] || 0) + toMin(it.to) - toMin(it.from);
    }
  }
  return mins;
}
