// Report des tâches non faites : fonctions pures, sans DOM ni réseau.
// Rien n'est écrit tant que la tâche n'est pas cochée : le report se calcule à l'affichage,
// à partir de la date du jour. Il n'y a donc aucun état de report à synchroniser entre appareils.
//
// Deux sortes d'occurrences se reportent : celle d'une tâche ponctuelle, et la dernière d'une
// série courte, dès le lendemain de ce dernier jour. Les autres jours d'une série valent chacun
// pour eux seuls ; une habitude (série longue ou sans fin) ne se reporte jamais.
//
// Aucun champ de plus pour le dire : dans `done`, une coche posée après le jour qui se reporte
// signifie « fait en retard, ce jour-là ». Les fonctions qui modifient une série (retrait d'un
// jour, changement de règle) veillent donc à ne jamais laisser de coche sur un jour qui n'en
// fait plus partie : elle serait lue comme un retard.

import { ds, parse, addDays, isDone, isShortSeries, lastOccurrence, occurs } from "./recurrence.js";

/** @import { Item } from "./items.js" */

/** Nombre de jours pendant lesquels une tâche non faite continue d'être reportée. */
export const CARRY_DAYS = 7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tâche « une seule fois ». @param {Item} it */
export const isOneOff = (it) => it.kind === "task" && (!it.recur || it.recur === "none");

/**
 * Jour de l'occurrence qui se reporte si elle n'est pas faite : la date d'une tâche ponctuelle,
 * le dernier jour d'une série courte. null pour un créneau, une habitude, une série sans aucun jour.
 * @param {Item} it
 * @returns {string | null}
 */
export function carryDay(it) {
  if (it.kind !== "task" || !it.start) return null;
  if (isOneOff(it)) return it.start;
  return isShortSeries(it) ? lastOccurrence(it) : null;
}

/**
 * Jour où l'occurrence qui se reporte a été cochée, ou null : son jour prévu, ou un jour
 * ultérieur si elle a été faite après report. Pour une série courte, une coche posée après
 * son dernier jour désigne ce dernier jour, fait en retard.
 * @param {Item} it
 * @returns {string | null}
 */
export function doneDay(it) {
  const from = carryDay(it);
  if (!from) return null;
  const days = Object.keys(it.done || {})
    // Une coche antérieure au jour prévu vaut pour un autre jour de la série, ou vient d'une ancienne règle.
    .filter((k) => DATE_RE.test(k) && it.done[k] === true && k >= from)
    .sort();
  return days.length ? days[days.length - 1] : null;
}

/**
 * La tâche est-elle faite, vue depuis le jour `day` ? L'occurrence qui se reporte n'a qu'un
 * état, partout où elle apparaît ; les autres jours d'une série valent chacun pour eux seuls.
 * @param {Item} it @param {string} day
 */
export function taskDone(it, day) {
  if (isOneOff(it)) return doneDay(it) !== null;
  const from = carryDay(it);
  return from !== null && day >= from ? doneDay(it) !== null : isDone(it, day);
}

/**
 * Coches après un clic sur la case du jour `day`. L'occurrence qui se reporte retient le jour
 * où elle a été faite ; la décocher l'efface, où qu'on clique.
 * @param {Item} it @param {string} day
 * @returns {Record<string, boolean>}
 */
export function doneAfterToggle(it, day) {
  const done = { ...(it.done || {}) };
  const from = carryDay(it);
  if (from === null || day < from) {
    if (done[day]) delete done[day];
    else done[day] = true;
    return done;
  }
  if (doneDay(it) === null) return isOneOff(it) ? { [day]: true } : { ...done, [day]: true };
  if (isOneOff(it)) return {};
  for (const k of Object.keys(done)) if (k >= from) delete done[k];
  return done;
}

/**
 * Coches après le retrait du jour `day` d'une série : un jour retiré n'est plus « fait ». Si c'était
 * le jour qui se reporte, la coche tardive qui le concernait part avec lui, pour ne pas être
 * attribuée au nouveau dernier jour.
 * @param {Item} it  la série avant le retrait @param {string} day
 * @returns {Record<string, boolean>}
 */
export function doneAfterSkip(it, day) {
  const late = carryDay(it) === day;
  return Object.fromEntries(Object.entries(it.done || {}).filter(([k]) => k !== day && !(late && k > day)));
}

/** Les deux éléments suivent-ils la même règle de répétition ? */
const sameRule = (/** @type {Item} */ a, /** @type {Item} */ b) =>
  a.kind === b.kind &&
  a.start === b.start &&
  a.recur === b.recur &&
  (a.until || "") === (b.until || "") &&
  [...(a.days || [])].sort().join() === [...(b.days || [])].sort().join();

/**
 * Coches à conserver quand un élément est modifié. Pour une tâche ponctuelle, la coche
 * dit « faite » sans autre précision : elle ne doit pas suivre un changement de date,
 * ni être héritée d'une série dont l'élément faisait partie.
 * @param {Item} before @param {Item} after
 * @returns {Record<string, boolean>}
 */
export function doneAfterEdit(before, after) {
  const was = isOneOff(before);
  const is = isOneOff(after);
  if (!was && !is) {
    let done = before.done || {};
    if (sameRule(before, after)) return done;
    // Série courte faite après report, dont la règle change : la coche tardive ne désignerait plus
    // rien de sûr. Elle redevient une coche du jour qui était prévu.
    const from = carryDay(before);
    if (from !== null && Object.keys(done).some((k) => k > from))
      done = { ...Object.fromEntries(Object.entries(done).filter(([k]) => k <= from)), [from]: true };
    // Devenue ou restée une série courte : une coche ne survit que si son jour en fait encore
    // partie. Restée sur un jour retiré par la nouvelle règle (fin avancée, jour de la semaine
    // décoché), elle passerait pour un dernier jour fait en retard. Une habitude garde tout son
    // historique : rien ne s'y reporte, donc rien ne peut y être mal lu.
    if (carryDay(after) === null) return done;
    return Object.fromEntries(Object.entries(done).filter(([k]) => occurs(after, k)));
  }
  const moved = before.start !== after.start;
  // Ponctuelle déplacée : elle est à refaire à sa nouvelle date.
  if (was && is) return moved ? {} : before.done || {};
  // Ponctuelle devenue série : la coche vaut pour le jour prévu.
  if (was) return !moved && doneDay(before) !== null ? { [after.start]: true } : {};
  // Série devenue ponctuelle, à la date de l'occurrence qui se reportait : elle garde son état,
  // et le jour où elle a été faite si c'était après report.
  if (carryDay(before) === after.start) {
    const done = doneDay(before);
    return done ? { [done]: true } : {};
  }
  // Sinon, seule compte la coche posée sur la date retenue.
  return before.done && before.done[after.start] === true ? { [after.start]: true } : {};
}

/**
 * La tâche est-elle en cours de report le jour `today` ? Oui si son occurrence était prévue
 * avant, depuis CARRY_DAYS jours au plus, et n'a jamais été cochée.
 * @param {Item} it @param {string} today "AAAA-MM-JJ"
 */
export function isCarrying(it, today) {
  const from = carryDay(it);
  if (from === null || from >= today) return false;
  if (it.skipped && it.skipped[from]) return false;
  if (doneDay(it) !== null) return false;
  return from >= ds(addDays(parse(today), -CARRY_DAYS));
}

/**
 * L'occurrence du jour `day` est-elle celle qui est reportée aujourd'hui ? Pour une série
 * courte, seul son dernier jour porte la marque du report.
 * @param {Item} it @param {string} day @param {string} today
 */
export const isCarriedFrom = (it, day, today) => isCarrying(it, today) && carryDay(it) === day;

/**
 * Tâches reportées à afficher le jour `day`, les plus anciennes d'abord :
 * - aujourd'hui, celles qui sont en cours de report ;
 * - n'importe quel jour, celles qui y ont été cochées après report (trace de ce qui a été fait).
 * @param {Item[]} items @param {string} day @param {string} today
 * @returns {Item[]}
 */
export function carriedFor(items, day, today) {
  return items
    .map((it) => ({ it, from: carryDay(it) }))
    .filter(({ it, from }) => {
      if (from === null || from >= day) return false;
      const done = doneDay(it);
      return done === null ? day === today && isCarrying(it, today) : done === day;
    })
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    .map(({ it }) => it);
}
