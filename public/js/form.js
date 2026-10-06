// Formulaire de création / modification d'un élément.

import { ds, parse, addDays, daysBetween, dow, toMin, fromMin, hasOccurrence, DN, DL } from "./recurrence.js";
import { CATS, LAST } from "./items.js";
import { doneAfterEdit } from "./carry.js";
import { conflicts, conflictText } from "./conflicts.js";
import { newId } from "./ids.js";
import { state, catLabel, putItem, removeItem } from "./state.js";
import { $, field, esc, arm, disarm, isArmed, focusSoon, registerDialog } from "./dom.js";
import { closeMenu } from "./menu.js";
import { isShown } from "./board.js";

/** @import { Item } from "./items.js" */

const form = /** @type {HTMLFormElement} */ ($("form"));
const recurSel = /** @type {HTMLSelectElement} */ ($("f-recur"));
const dayBox = (i) => field(`f-d${i}`);
let durChips = [];
let spanChips = [];
/** @type {Item|null} élément en cours de modification, null pour une création */
let editing = null;
/** Dernière date de départ saisie : quand elle change, la fin de la série suit. */
let lastStart = "";
/**
 * Date complète et vraisemblable. Pendant la saisie au clavier, le champ passe par des années
 * à un, deux puis trois chiffres (« 0002 », « 0020 », « 0202 ») : on n'en tire aucun calcul.
 */
const settled = (/** @type {string} */ day) => /^[1-9]\d{3}-\d{2}-\d{2}$/.test(day);

function buildCatOptions() {
  $("f-cats").innerHTML = CATS.map(
    (c) =>
      `<label data-cat="${c}"><input type="radio" name="cat" id="f-cat-${c}" value="${c}"><span>${esc(catLabel(c))}</span></label>`,
  ).join("");
}

function syncForm() {
  $("daysField").hidden = recurSel.value !== "weekly";
  $("untilField").hidden = recurSel.value === "none";
  // Les raccourcis en jours ne valent que pour une série quotidienne ; « Sans fin » vaut pour toutes.
  for (const c of spanChips) c.hidden = c.dataset.span !== "0" && recurSel.value !== "daily";
  syncSpan();
  $("timeHint").textContent = field("f-kind-block").checked
    ? "Un créneau bloqué occupe la grille : heure de début et de fin obligatoires."
    : "Sans heure, la tâche va dans la ligne « À faire » du jour.";
  syncDur();
}

/** Met en évidence la puce de durée qui correspond aux heures saisies. */
function syncDur() {
  const f = field("f-from").value;
  const t = field("f-to").value;
  const d = f && t ? toMin(t) - toMin(f) : null;
  for (const c of durChips) c.setAttribute("aria-pressed", String(Number(c.dataset.dur) === d));
}

/** Met en évidence le raccourci qui correspond à la date de fin saisie. */
function syncSpan() {
  const start = field("f-date").value;
  const until = field("f-until").value;
  const n = settled(start) && settled(until) ? daysBetween(start, until) + 1 : null;
  // « Sans fin » : aucune date de fin. Les autres : la série dure exactement ce nombre de jours.
  for (const c of spanChips) {
    const span = Number(c.dataset.span);
    c.setAttribute("aria-pressed", String(span === 0 ? !until : span === n));
  }
}

/** L'élément tel qu'il serait enregistré, pour ce qui compte dans un chevauchement ; null s'il est incomplet. */
function draftBlock() {
  const start = field("f-date").value;
  const from = field("f-from").value;
  const to = field("f-to").value;
  if (!field("f-kind-block").checked || !start || !from || !to || toMin(to) <= toMin(from)) return null;
  const recur = /** @type {Item["recur"]} */ (recurSel.value);
  /** @type {Item} */
  const it = {
    id: editing?.id || "",
    title: "",
    kind: "block",
    start,
    from,
    to,
    recur,
    cat: "bleu",
    done: {},
    skipped: {},
  };
  if (recur === "weekly") it.days = [0, 1, 2, 3, 4, 5, 6].filter((i) => dayBox(i).checked);
  if (recur !== "none" && field("f-until").value) it.until = field("f-until").value;
  if (editing?.skipped) it.skipped = editing.skipped;
  return it;
}

/** Signale un créneau qui en recouvre un autre. Rien n'est bloqué : c'est parfois voulu. */
function syncClash() {
  const it = draftBlock();
  const text = it ? conflictText(conflicts(state.items, it, ds(new Date()))) : "";
  const hint = $("clashHint");
  // La zone est annoncée par les lecteurs d'écran : on n'y touche que si le texte change.
  if (hint.textContent !== text) hint.textContent = text;
  hint.hidden = !text;
}

/**
 * @param {Item|null} it  élément à modifier, ou null pour en créer un
 * @param {{ date?: string, from?: string, to?: string, kind?: "block"|"task", title?: string, cat?: string, heading?: string }} [pre]
 *   valeurs proposées pour une création ; `heading` remplace le titre de la fenêtre
 */
export function openForm(it, pre = {}) {
  closeMenu();
  editing = it;
  $("formTitle").textContent = it ? "Modifier" : pre.heading || "Nouvel élément";
  field("f-title").value = it ? it.title : pre.title || "";
  const kind = it ? it.kind : pre.kind || "task";
  field(`f-kind-${kind}`).checked = true;
  field("f-date").value = it ? it.start : pre.date || ds(state.sel);
  lastStart = field("f-date").value;
  field("f-until").value = it?.until || "";
  field("f-from").value = it ? it.from || "" : pre.from || "";
  field("f-to").value = it ? it.to || "" : pre.to || "";
  recurSel.value = it ? it.recur || "none" : "none";
  const days = it?.days || [];
  for (let i = 0; i < 7; i++) dayBox(i).checked = days.includes(i);
  buildCatOptions();
  field(`f-cat-${it?.cat || pre.cat || state.focusCat || (kind === "block" ? "bleu" : "ambre")}`).checked = true;
  $("f-delete").hidden = !it;
  disarm($("f-delete"), it && it.recur && it.recur !== "none" ? "Supprimer la série" : "Supprimer");
  $("formErr").hidden = true;
  syncForm();
  syncClash();
  $("formScrim").hidden = false;
  focusSoon(field("f-title"));
}

function closeForm() {
  $("formScrim").hidden = true;
  editing = null;
}

function fail(msg) {
  const e = $("formErr");
  e.textContent = msg;
  e.hidden = false;
}

function submit(e) {
  e.preventDefault();
  const title = field("f-title").value.trim();
  const kind = field("f-kind-block").checked ? "block" : "task";
  const start = field("f-date").value;
  const from = field("f-from").value;
  let to = field("f-to").value;
  const recur = /** @type {Item["recur"]} */ (recurSel.value);
  const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => dayBox(i).checked);
  const until = recur === "none" ? "" : field("f-until").value;
  const cat = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="cat"]:checked'))?.value || "bleu";
  if (!title) return fail("Donne un intitulé à cet élément.");
  if (!start) return fail("Choisis une date de départ.");
  if (kind === "block" && (!from || !to)) return fail("Un créneau bloqué a besoin d'une heure de début et de fin.");
  if (!from && to) return fail("Ajoute l'heure de début, ou efface l'heure de fin.");
  if (from && !to) to = fromMin(Math.min(toMin(from) + 30, LAST));
  if (from && toMin(to) <= toMin(from)) return fail("L'heure de fin doit être après l'heure de début.");
  if (recur === "weekly" && !days.length) return fail("Coche au moins un jour de la semaine.");
  if (until && until < start) return fail("La série ne peut pas finir avant son premier jour.");

  const wasNew = !editing;
  const base = editing ? { ...editing } : { id: newId(), done: {}, skipped: {} };
  /** @type {Item} */
  const it = { ...base, title, kind, start, recur, cat };
  if (from) {
    it.from = from;
    it.to = to;
  } else {
    delete it.from;
    delete it.to;
  }
  if (recur === "weekly") it.days = days;
  else delete it.days;
  if (until) it.until = until;
  else delete it.until;
  // Hebdo du vendredi finie le jeudi, par exemple : l'élément n'apparaîtrait nulle part.
  if (!hasOccurrence(it))
    return fail("Avec cette date de fin, la série n'a aucun jour. Repousse la fin, ou change les jours.");
  if (editing) it.done = doneAfterEdit(editing, it);
  closeForm();
  // Un nouvel élément posé hors de la période affichée : on y va, pour le voir apparaître.
  if (wasNew && !isShown(start)) state.sel = parse(start);
  putItem(it);
}

export function initForm() {
  $("f-days").innerHTML = DN.map(
    (n, i) =>
      `<label title="${DL[i]}"><input type="checkbox" id="f-d${i}" value="${i}"><span>${n.slice(0, 1)}</span></label>`,
  ).join("");
  durChips = /** @type {HTMLElement[]} */ ([...$("f-durs").querySelectorAll("[data-dur]")]);
  spanChips = /** @type {HTMLElement[]} */ ([...$("f-spans").querySelectorAll("[data-span]")]);
  buildCatOptions();

  $("f-spans").addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-span]");
    if (!(b instanceof HTMLElement)) return;
    const n = Number(b.dataset.span);
    const start = field("f-date").value;
    // « 3 jours » : le premier jour compte, la série finit donc deux jours plus tard.
    field("f-until").value = n && settled(start) ? ds(addDays(parse(start), n - 1)) : "";
    syncSpan();
    syncClash();
  });
  field("f-until").addEventListener("input", syncSpan);
  field("f-date").addEventListener("input", () => {
    // La date de départ bouge : la série garde sa durée. Une date en cours de saisie ne compte pas.
    const start = field("f-date").value;
    const until = field("f-until").value;
    if (settled(start)) {
      if (settled(until) && settled(lastStart))
        field("f-until").value = ds(addDays(parse(until), daysBetween(lastStart, start)));
      lastStart = start;
    }
    syncSpan();
  });

  $("f-durs").addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-dur]");
    if (!(b instanceof HTMLElement)) return;
    let from = field("f-from").value;
    if (!from) {
      // Pas d'heure de début : le prochain quart d'heure.
      const n = new Date();
      from = fromMin(Math.min(Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15, 23 * 60));
      field("f-from").value = from;
    }
    field("f-to").value = fromMin(Math.min(toMin(from) + Number(b.dataset.dur), LAST));
    syncDur();
    syncClash();
  });
  field("f-from").addEventListener("input", syncDur);
  field("f-to").addEventListener("input", syncDur);
  recurSel.onchange = () => {
    // Passage en hebdo sans jour coché : on coche celui de la date de départ.
    const date = field("f-date").value;
    if (recurSel.value === "weekly" && ![0, 1, 2, 3, 4, 5, 6].some((i) => dayBox(i).checked) && date)
      dayBox(dow(parse(date))).checked = true;
    syncForm();
  };
  form.addEventListener("change", (e) => {
    if (/** @type {HTMLInputElement} */ (e.target).name === "kind") syncForm();
  });
  // Toute saisie peut créer ou lever un chevauchement : date, heures, type, répétition, jours, fin.
  form.addEventListener("input", syncClash);
  form.addEventListener("submit", submit);
  $("f-cancel").onclick = closeForm;
  $("f-delete").onclick = () => {
    const b = $("f-delete");
    if (!isArmed(b)) return arm(b, "Confirmer la suppression");
    if (editing) removeItem(editing.id);
    closeForm();
  };
  registerDialog("formScrim", closeForm);
}
