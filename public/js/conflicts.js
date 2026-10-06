// Chevauchements entre créneaux bloqués : fonctions pures, sans DOM ni réseau.
// Deux créneaux peuvent se recouvrir (la grille les place côte à côte) : ce module sert
// seulement à le signaler au moment où on en crée ou déplace un.

import { ds, parse, addDays, occurs, toMin } from "./recurrence.js";

/** @import { Item } from "./items.js" */

/** Nombre de jours examinés à partir du premier jour concerné (cinq semaines). */
export const CONFLICT_DAYS = 35;

const fmtDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/** Deux créneaux horaires se recouvrent-ils ? Bout à bout (10:00–11:00 puis 11:00–12:00), non. */
const overlap = (a, b) => toMin(a.from) < toMin(b.to) && toMin(b.from) < toMin(a.to);

/**
 * Jours où le créneau `it` en recouvre d'autres, de `from` compris à CONFLICT_DAYS jours plus tard.
 * Seuls les créneaux bloqués comptent : une tâche placée à une heure peut se faire pendant un créneau.
 * @param {Item[]} items  le planning ; `it` lui-même (même id) y est ignoré
 * @param {Item} it
 * @param {string} from "AAAA-MM-JJ" premier jour examiné
 * @param {number} [days]
 * @returns {Array<{ day: string, others: Item[] }>}  du plus proche au plus lointain
 */
export function conflicts(items, it, from, days = CONFLICT_DAYS) {
  if (it.kind !== "block" || !it.from || !it.to) return [];
  const blocks = items.filter((o) => o.id !== it.id && o.kind === "block" && o.from && o.to);
  const first = from > it.start ? from : it.start;
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = ds(addDays(parse(first), i));
    if (!occurs(it, day)) continue;
    const others = blocks.filter((o) => occurs(o, day) && overlap(it, o));
    if (others.length) out.push({ day, others });
    // Un élément ponctuel n'a qu'un jour : inutile de parcourir la suite.
    if (!it.recur || it.recur === "none") break;
  }
  return out;
}

/**
 * Phrase qui signale les chevauchements trouvés, ou "" s'il n'y en a pas.
 * @param {Array<{ day: string, others: Item[] }>} found
 */
export function conflictText(found) {
  if (!found.length) return "";
  const { day, others } = found[0];
  const o = others[0];
  const more = others.length - 1;
  const who = `« ${o.title} » (${o.from}–${o.to})${more ? ` et ${more} autre${more > 1 ? "s" : ""} créneau${more > 1 ? "x" : ""}` : ""}`;
  const rest = found.length - 1;
  const also = rest ? `, et d'autres créneaux sur ${rest} autre${rest > 1 ? "s" : ""} jour${rest > 1 ? "s" : ""}` : "";
  return `Chevauche ${who} le ${fmtDay.format(parse(day))}${also}.`;
}
