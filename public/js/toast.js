// Notifications : encarts empilés en bas de l'écran, le plus récent en bas.
// Une confirmation disparaît seule ; une erreur, un résultat d'import ou un chevauchement signalé
// restent jusqu'au clic sur « OK ».

import { state, dropStatus } from "./state.js";
import { $, el } from "./dom.js";

/** Durée d'affichage d'une confirmation, en millisecondes. */
const AUTO_MS = 5000;
/** Décompte en cours de chaque confirmation, par identifiant. @type {Map<number, number>} */
const timers = new Map();

/** @param {number} id */
function stopTimer(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

/** @param {number} id */
function startTimer(id) {
  stopTimer(id);
  timers.set(
    id,
    window.setTimeout(() => dropStatus(id), AUTO_MS),
  );
}

/** @param {import("./state.js").Toast} t */
function build(t) {
  const box = el("div", { class: `toast${t.warn ? " warn" : ""}` }, [el("span", { class: "toast-msg", text: t.msg })]);
  box.dataset.toast = String(t.id);
  if (t.sticky) box.append(el("button", { class: "btn", type: "button", text: "OK", onclick: () => dropStatus(t.id) }));
  else {
    // Le temps de lecture ne court pas pendant que le pointeur est sur l'encart.
    box.addEventListener("pointerenter", () => stopTimer(t.id));
    box.addEventListener("pointerleave", () => startTimer(t.id));
    startTimer(t.id);
  }
  return box;
}

/** Aligne les encarts affichés sur `state.toasts` : seuls les nouveaux sont créés (et animés). */
export function renderToast() {
  const zone = $("toasts");
  const wanted = new Set(state.toasts.map((t) => t.id));
  for (const box of [...zone.children]) {
    const id = Number(/** @type {HTMLElement} */ (box).dataset.toast);
    if (!wanted.has(id)) {
      stopTimer(id);
      box.remove();
    }
  }
  const shown = new Set([...zone.children].map((box) => Number(/** @type {HTMLElement} */ (box).dataset.toast)));
  for (const t of state.toasts) if (!shown.has(t.id)) zone.append(build(t));
}

/** Ferme la notification la plus récente. @returns {boolean} vrai s'il y en avait une */
export function dismissToast() {
  const last = state.toasts.at(-1);
  if (!last) return false;
  dropStatus(last.id);
  return true;
}
