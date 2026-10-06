// « Refaire » : recopier un élément à une autre date. Fonctions pures, sans DOM ni réseau.

import { ds, parse, addDays, DN } from "./recurrence.js";
import { newId } from "./ids.js";

/** @import { Item } from "./items.js" */

const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const fmtLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

const tomorrowOf = (/** @type {string} */ day) => ds(addDays(parse(day), 1));

/**
 * Jour proposé pour refaire un élément : le lendemain du jour où il est prévu, ou demain
 * si ce jour est passé. La copie n'atterrit donc jamais dans le passé.
 * @param {string} day    "AAAA-MM-JJ" jour de l'occurrence regardée
 * @param {string} today
 */
export const redoDay = (day, today) => tomorrowOf(day > today ? day : today);

/**
 * Nom du jour proposé, pour le bouton : « Demain », sinon la date (« Sam. 10 oct. »).
 * @param {string} target @param {string} today
 */
export function redoLabel(target, today) {
  if (target === tomorrowOf(today)) return "Demain";
  const d = parse(target);
  return `${DN[(d.getDay() + 6) % 7]}. ${fmtShort.format(d)}`;
}

/**
 * Le même jour, dans une phrase : « demain », sinon « le samedi 10 octobre ».
 * @param {string} target @param {string} today
 */
export const redoWhen = (target, today) =>
  target === tomorrowOf(today) ? "demain" : `le ${fmtLong.format(parse(target))}`;

/**
 * Copie indépendante d'un élément, à faire une seule fois le jour `day` : même intitulé,
 * même type, même catégorie, mêmes heures ; ni répétition, ni coche, ni jour retiré.
 * @param {Item} it @param {string} day "AAAA-MM-JJ"
 * @returns {Item}
 */
export function redoCopy(it, day) {
  /** @type {Item} */
  const copy = {
    id: newId(),
    title: it.title,
    kind: it.kind,
    start: day,
    recur: "none",
    cat: it.cat,
    done: {},
    skipped: {},
  };
  if (it.from && it.to) {
    copy.from = it.from;
    copy.to = it.to;
  }
  return copy;
}
