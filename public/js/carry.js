// Report des tâches ponctuelles non faites : fonctions pures, sans DOM ni réseau.
// Rien n'est écrit tant que la tâche n'est pas cochée : le report se calcule à l'affichage,
// à partir de la date du jour. Il n'y a donc aucun état de report à synchroniser entre appareils.

import { ds, parse, addDays, isDone } from "./recurrence.js";

/** @import { Item } from "./items.js" */

/** Nombre de jours pendant lesquels une tâche non faite continue d'être reportée. */
export const CARRY_DAYS = 7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tâche « une seule fois » : la seule qui se reporte. Une tâche récurrente ne se reporte pas, pas même
 * la dernière occurrence d'une série qui a une fin : chaque jour d'une série vaut pour lui seul.
 * @param {Item} it
 */
export const isOneOff = (it) => it.kind === "task" && (!it.recur || it.recur === "none");

/**
 * Jour où une tâche ponctuelle a été cochée, ou null. Ce peut être sa date prévue
 * ou un jour ultérieur si elle a été faite après report.
 * @param {Item} it
 * @returns {string | null}
 */
export function doneDay(it) {
  const days = Object.keys(it.done || {})
    // Une coche antérieure à la date prévue ne peut venir que d'une ancienne règle : on l'ignore.
    .filter((k) => DATE_RE.test(k) && it.done[k] === true && k >= it.start)
    .sort();
  return days.length ? days[days.length - 1] : null;
}

/**
 * La tâche est-elle faite, vue depuis le jour `day` ? Une tâche ponctuelle cochée
 * l'est partout où elle apparaît ; une récurrente ne l'est que pour le jour coché.
 * @param {Item} it @param {string} day
 */
export const taskDone = (it, day) => (isOneOff(it) ? doneDay(it) !== null : isDone(it, day));

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
  if (!was && !is) return before.done || {};
  const moved = before.start !== after.start;
  // Ponctuelle déplacée : elle est à refaire à sa nouvelle date.
  if (was && is) return moved ? {} : before.done || {};
  // Ponctuelle devenue série : la coche vaut pour le jour prévu.
  if (was) return !moved && doneDay(before) !== null ? { [after.start]: true } : {};
  // Série devenue ponctuelle : seule compte la coche posée sur la date retenue.
  return before.done && before.done[after.start] === true ? { [after.start]: true } : {};
}

/**
 * La tâche est-elle en cours de report le jour `today` ? Oui si elle était prévue
 * avant, depuis CARRY_DAYS jours au plus, et n'a jamais été cochée.
 * @param {Item} it @param {string} today "AAAA-MM-JJ"
 */
export function isCarrying(it, today) {
  if (!isOneOff(it) || !it.start || it.start >= today) return false;
  if (it.skipped && it.skipped[it.start]) return false;
  if (doneDay(it) !== null) return false;
  return it.start >= ds(addDays(parse(today), -CARRY_DAYS));
}

/**
 * Tâches reportées à afficher le jour `day`, les plus anciennes d'abord :
 * - aujourd'hui, celles qui sont en cours de report ;
 * - n'importe quel jour, celles qui y ont été cochées après report (trace de ce qui a été fait).
 * @param {Item[]} items @param {string} day @param {string} today
 * @returns {Item[]}
 */
export function carriedFor(items, day, today) {
  return items
    .filter((it) => {
      if (!isOneOff(it) || !it.start || it.start >= day) return false;
      const done = doneDay(it);
      return done === null ? day === today && isCarrying(it, today) : done === day;
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
