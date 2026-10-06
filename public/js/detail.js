// Fenêtre de détail d'une occurrence : cocher, refaire, retirer ce jour, modifier, supprimer.

import { ds, parse, recurText, hasOccurrence } from "./recurrence.js";
import { isCarrying, isOneOff, carryDay, doneDay, taskDone } from "./carry.js";
import { conflicts, conflictText } from "./conflicts.js";
import { redoDay, redoLabel, redoWhen, redoCopy } from "./redo.js";
import { state, catLabel, skipDay, toggleDone, removeItem, findItem, putItem, setStatus } from "./state.js";
import { $, esc, arm, disarm, isArmed, focusSoon, registerDialog } from "./dom.js";
import { closeMenu } from "./menu.js";
import { openForm } from "./form.js";

const fmtLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
/** @type {{ id: string, day: string, redo: string } | null} occurrence affichée, et jour proposé pour la refaire */
let cur = null;

/** @param {string} id @param {string} day "AAAA-MM-JJ" */
export function openDetail(id, day) {
  const it = findItem(id);
  if (!it) return;
  closeMenu();
  $("detTitle").textContent = it.title;
  $("det").dataset.cat = it.cat || "bleu";
  // L'occurrence qui se reporte (tâche ponctuelle, dernier jour d'une série courte) garde sa date
  // prévue, même ouverte depuis le jour où elle est reportée.
  const from = carryDay(it);
  const single = from !== null && day >= from;
  const date = single ? from : day;
  const today = ds(new Date());
  cur = { id, day, redo: redoDay(date, today) };
  $("d-redo").textContent = redoLabel(cur.redo, today);
  const done = it.kind === "task" && taskDone(it, day);
  const doneOn = single ? doneDay(it) : null;
  let status = "";
  if (it.kind === "task") {
    if (doneOn && doneOn !== from) status = `Faite le <b>${esc(fmtLong.format(parse(doneOn)))}</b>, après report`;
    else if (isOneOff(it)) status = `État : <b>${done ? "faite" : "à faire"}</b>`;
    else status = `État ce jour : <b>${done ? "faite" : "à faire"}</b>`;
    if (single && isCarrying(it, today)) status += " · reportée à aujourd'hui";
  }
  $("detMeta").innerHTML = `
    <span><b>${esc(fmtLong.format(parse(date)))}</b>${it.from ? ` · ${esc(it.from)} → ${esc(it.to)}` : " · sans heure"}</span>
    <span>${it.kind === "block" ? "Créneau bloqué" : "Tâche"} · ${esc(catLabel(it.cat))}</span>
    <span>${esc(recurText(it))}</span>
    ${status ? `<span>${status}</span>` : ""}`;
  const recurring = it.recur && it.recur !== "none";
  // « Retirer ce jour » vise le jour affiché : pas de sens depuis le jour où l'occurrence est reportée.
  $("d-skip").hidden = !recurring || day !== date;
  disarm($("d-del"), recurring ? "Supprimer la série" : "Supprimer");
  const t = $("d-toggle");
  t.hidden = it.kind !== "task";
  t.textContent = done ? "Remettre à faire" : "Marquer faite";
  $("detScrim").hidden = false;
  focusSoon($("d-edit"));
}

function closeDetail() {
  $("detScrim").hidden = true;
  cur = null;
}

export function initDetail() {
  $("d-toggle").onclick = () => {
    toggleDone(cur.id, cur.day);
    closeDetail();
  };
  $("d-redo").onclick = () => {
    const it = findItem(cur.id);
    if (!it) return closeDetail();
    const copy = redoCopy(it, cur.redo);
    const today = ds(new Date());
    const clash = conflictText(conflicts(state.items, copy, today));
    closeDetail();
    putItem(copy);
    // Un chevauchement reste affiché jusqu'au clic sur « OK » : il ne doit pas passer inaperçu.
    setStatus(
      `« ${copy.title} » : copie créée pour ${redoWhen(copy.start, today)}.${clash ? ` ${clash}` : ""}`,
      false,
      !!clash,
    );
  };
  $("d-redo-other").onclick = () => {
    const it = findItem(cur.id);
    const date = cur.redo;
    closeDetail();
    if (!it) return;
    // Le formulaire s'ouvre prérempli : tout y reste modifiable, la copie est un élément à part entière.
    openForm(null, {
      heading: `Refaire « ${it.title} »`,
      title: it.title,
      kind: it.kind,
      cat: it.cat,
      date,
      from: it.from,
      to: it.to,
    });
  };
  $("d-skip").onclick = () => {
    const it = findItem(cur.id);
    const { id, day } = cur;
    closeDetail();
    if (!it) return;
    // Dernier jour d'une série qui a une fin : il ne resterait qu'un élément sans aucune occurrence,
    // qu'aucun écran ne permettrait plus d'ouvrir. On supprime donc la série.
    if (!hasOccurrence({ ...it, skipped: { ...(it.skipped || {}), [day]: true } })) {
      removeItem(id);
      setStatus(`« ${it.title} » : c'était le dernier jour de la série, elle est supprimée.`);
    } else skipDay(id, day);
  };
  $("d-edit").onclick = () => {
    const it = findItem(cur.id);
    closeDetail();
    if (it) openForm(it);
  };
  $("d-del").onclick = () => {
    const b = $("d-del");
    if (!isArmed(b)) return arm(b, "Confirmer la suppression");
    removeItem(cur.id);
    closeDetail();
  };
  registerDialog("detScrim", closeDetail);
}
