// Sauvegarde : contenu du fichier exporté, lecture d'un fichier importé, rappel.
// Aucune dépendance au DOM : testé directement sous Node.

import { sanitize, cleanLabels, DEFAULT_LABELS, CATS } from "./items.js";

/** @import { Item } from "./items.js" */

/** Version du format de fichier. 1 : éléments seuls. 2 : éléments et noms des catégories. */
export const FORMAT = 2;
/** Taille maximale d'un fichier importé : un planning réel pèse quelques dizaines de ko. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Au-delà, le menu rappelle de refaire une sauvegarde. */
export const REMIND_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Contenu du fichier de sauvegarde.
 * @param {Item[]} items
 * @param {Record<string, string>} labels
 * @param {Date} [now]
 */
export function buildExport(items, labels, now = new Date()) {
  return {
    app: "semainier",
    format: FORMAT,
    exportedAt: now.toISOString(),
    labels: cleanLabels(labels),
    items: items.map((it) => ({ ...it })),
  };
}

/**
 * Lit le texte d'un fichier importé. Rien n'est repris tel quel : chaque élément
 * et chaque nom de catégorie est revalidé.
 * @param {string} text
 * @returns {{ ok: false, error: string } | { ok: true, items: Item[], invalid: number, labels: Record<string, string> | null }}
 */
export function readExport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Ce fichier n'est pas un JSON valide." };
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null;
  if (!list) return { ok: false, error: "Fichier non reconnu : il faut une sauvegarde du Semainier." };
  const items = list.map(sanitize).filter(Boolean);
  const rawLabels = Array.isArray(parsed) ? null : parsed.labels;
  const labels =
    rawLabels && typeof rawLabels === "object" && !Array.isArray(rawLabels) ? cleanLabels(rawLabels) : null;
  return { ok: true, items, invalid: list.length - items.length, labels };
}

/**
 * Empreinte du contenu d'un élément, hors identifiant, coches et jours retirés.
 * Deux éléments de même empreinte ont le même intitulé, le même type, la même catégorie,
 * les mêmes heures et la même règle de répétition, fin comprise.
 * @param {Item} it
 */
export function signature(it) {
  const days = it.recur === "weekly" ? [...(it.days || [])].sort((a, b) => a - b) : [];
  const until = it.recur && it.recur !== "none" ? it.until || "" : "";
  return JSON.stringify([it.title, it.kind, it.start, it.from || "", it.to || "", it.recur, days, it.cat, until]);
}

/**
 * Sépare les éléments importés de ceux que le planning contient déjà.
 * Le compte se fait par exemplaire : deux éléments identiques dans la sauvegarde
 * restent deux éléments après une restauration sur un planning vide.
 * @param {Item[]} incoming
 * @param {Item[]} existing
 * @returns {{ fresh: Item[], duplicates: number }}
 */
export function withoutDuplicates(incoming, existing) {
  /** @type {Map<string, number>} */
  const have = new Map();
  for (const it of existing) have.set(signature(it), (have.get(signature(it)) || 0) + 1);
  const fresh = [];
  for (const it of incoming) {
    const key = signature(it);
    const left = have.get(key) || 0;
    if (left > 0) have.set(key, left - 1);
    else fresh.push(it);
  }
  return { fresh, duplicates: incoming.length - fresh.length };
}

/** @param {Record<string, string>} labels */
export const isDefaultLabels = (labels) => CATS.every((c) => labels[c] === DEFAULT_LABELS[c]);

/**
 * État du rappel de sauvegarde sur cet appareil.
 * @param {string | null} lastIso  date du dernier export fait ici, ou null
 * @param {Date} [now]
 * @returns {{ text: string, late: boolean, never: boolean }}
 */
export function backupReminder(lastIso, now = new Date()) {
  const last = lastIso ? new Date(lastIso) : null;
  if (!last || Number.isNaN(last.getTime())) {
    return { text: "Aucune sauvegarde faite depuis cet appareil.", late: false, never: true };
  }
  const midnight = (/** @type {Date} */ d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((midnight(now) - midnight(last)) / DAY_MS));
  const late = days > REMIND_AFTER_DAYS;
  const when = days === 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`;
  return { text: `Dernière sauvegarde : ${when}.${late ? " Pense à en refaire une." : ""}`, late, never: false };
}
