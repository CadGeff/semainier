// Modèle d'un élément du planning : constantes, validation des imports, données d'exemple.
// Aucune dépendance au DOM : testé directement sous Node.

import { ds, parse, addDays, dow, mondayOf, toMin } from "./recurrence.js";
import { newId } from "./ids.js";

/**
 * Un élément tel que l'application le manipule (une règle, pas une occurrence).
 * @typedef {object} Item
 * @property {string} id
 * @property {string} title
 * @property {"block"|"task"} kind          créneau bloqué ou tâche à cocher
 * @property {string} start                 "AAAA-MM-JJ", première occurrence
 * @property {string} [from]                "HH:MM"
 * @property {string} [to]                  "HH:MM"
 * @property {"none"|"daily"|"weekly"|"monthly"} recur
 * @property {number[]} [days]              jours de la semaine (0 = lundi) pour "weekly"
 * @property {string} [until]               "AAAA-MM-JJ", dernier jour d'une série ; absent : sans fin
 * @property {string} cat                   catégorie (couleur)
 * @property {Record<string, boolean>} done     jours cochés
 * @property {Record<string, boolean>} skipped  jours retirés de la série
 */

export const CATS = ["bleu", "vert", "ambre", "rose", "gris"];
export const DEFAULT_LABELS = {
  bleu: "Travail",
  vert: "Sport & santé",
  ambre: "Admin",
  rose: "Rendez-vous",
  gris: "Perso",
};
const KINDS = ["block", "task"];
const RECURS = ["none", "daily", "weekly", "monthly"];
/** Dernière minute de la journée (23:59). */
export const LAST = 23 * 60 + 59;
export const TITLE_MAX = 120;
export const LABEL_MAX = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Chaîne "AAAA-MM-JJ" désignant un jour qui existe (pas de 30 février). @param {unknown} v */
const isDate = (v) => typeof v === "string" && DATE_RE.test(v) && ds(parse(v)) === v;
/** @param {unknown} v */
const isTime = (v) => typeof v === "string" && TIME_RE.test(v);

/**
 * Noms des catégories : 30 caractères max, nom par défaut si vide ou invalide.
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function cleanLabels(raw) {
  const out = { ...DEFAULT_LABELS };
  if (raw && typeof raw === "object") {
    for (const c of CATS) {
      const v = typeof raw[c] === "string" ? raw[c].trim().slice(0, LABEL_MAX) : "";
      if (v) out[c] = v;
    }
  }
  return out;
}

/**
 * Valide un élément venu d'un fichier importé : tout champ inconnu est ignoré,
 * tout champ invalide est corrigé ou l'élément est rejeté. Un nouvel id est attribué.
 * @param {unknown} raw
 * @returns {Item | null}
 */
export function sanitize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, any>} */ (raw);
  const title = typeof r.title === "string" ? r.title.trim().slice(0, TITLE_MAX) : "";
  if (!title || !KINDS.includes(r.kind) || !isDate(r.start)) return null;
  /** @type {Item} */
  const it = {
    id: newId(),
    title,
    kind: r.kind,
    start: r.start,
    recur: RECURS.includes(r.recur) ? r.recur : "none",
    cat: CATS.includes(r.cat) ? r.cat : "bleu",
    done: {},
    skipped: {},
  };
  if (isTime(r.from) && isTime(r.to) && toMin(r.to) > toMin(r.from)) {
    it.from = r.from;
    it.to = r.to;
  } else if (it.kind === "block") return null;
  if (it.recur === "weekly") {
    it.days = Array.isArray(r.days) ? [...new Set(r.days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))] : [];
    if (!it.days.length) it.days = [dow(parse(it.start))];
  }
  // Une date de fin n'a de sens que pour une série, et pas avant son premier jour.
  if (it.recur !== "none" && isDate(r.until) && r.until >= it.start) it.until = r.until;
  for (const f of /** @type {const} */ (["done", "skipped"])) {
    if (r[f] && typeof r[f] === "object") {
      for (const k of Object.keys(r[f])) if (isDate(k) && r[f][k] === true) it[f][k] = true;
    }
  }
  return it;
}

/**
 * Données d'exemple de la démo (#demo) et du mode local au premier lancement,
 * calées sur la semaine de `now`.
 * @param {Date} [now]
 * @returns {Item[]}
 */
export function sample(now = new Date()) {
  const mon = mondayOf(now);
  const d = (n) => ds(addDays(mon, n));
  const today = ds(now);
  /** @returns {Item} */
  const mk = (o) => ({ id: newId(), done: {}, skipped: {}, ...o });
  const reading = mk({ title: "Lire 20 pages", kind: "task", start: d(0), recur: "daily", cat: "gris" });
  const plan = mk({
    title: "Planifier demain",
    kind: "task",
    start: d(0),
    from: "21:00",
    to: "21:15",
    recur: "daily",
    cat: "ambre",
  });
  for (let i = 0; i < 7; i++) {
    const day = d(i);
    if (day < today) {
      reading.done[day] = true;
      if (i % 3 !== 2) plan.done[day] = true;
    }
  }
  return [
    mk({
      title: "Deep work",
      kind: "block",
      start: d(0),
      from: "09:00",
      to: "11:00",
      recur: "weekly",
      days: [0, 1, 2, 3, 4],
      cat: "bleu",
    }),
    mk({
      title: "Point d'équipe",
      kind: "block",
      start: d(0),
      from: "11:30",
      to: "12:00",
      recur: "weekly",
      days: [0, 3],
      cat: "rose",
    }),
    mk({
      title: "Cours d'anglais",
      kind: "block",
      start: d(2),
      from: "14:00",
      to: "15:30",
      recur: "weekly",
      days: [2],
      cat: "rose",
    }),
    mk({
      title: "Sport",
      kind: "block",
      start: d(1),
      from: "18:30",
      to: "19:30",
      recur: "weekly",
      days: [1, 3, 5],
      cat: "vert",
    }),
    mk({
      title: "Appeler le comptable",
      kind: "task",
      start: d(2),
      from: "16:00",
      to: "16:30",
      recur: "none",
      cat: "ambre",
    }),
    mk({
      title: "Envoyer la facture",
      kind: "task",
      start: d(2),
      from: "16:15",
      to: "16:45",
      recur: "none",
      cat: "ambre",
    }),
    mk({
      title: "Revue de la semaine",
      kind: "task",
      start: d(6),
      from: "18:00",
      to: "18:45",
      recur: "weekly",
      days: [6],
      cat: "bleu",
    }),
    mk({ title: "Faire les comptes du mois", kind: "task", start: d(4), recur: "monthly", cat: "ambre" }),
    mk({ title: "Courses", kind: "task", start: d(5), recur: "weekly", days: [5], cat: "gris" }),
    reading,
    plan,
  ];
}
