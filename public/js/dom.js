// Petits outils DOM partagés.

/** @param {string} id */
export const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** Champ de formulaire (input ou select) par son id. @param {string} id */
export const field = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
/** @param {string} id */
export const button = (id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Échappe un texte avant de l'insérer dans du HTML. @param {unknown} s */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Coche des cases à cocher dessinées (tâches). */
export const CHECK =
  '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5.2 4.2 7.3 8 2.8" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Crée un élément sans passer par du HTML : le texte est toujours posé en textContent.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [props]  `class`, `text`, ou toute propriété DOM (onclick, type…)
 * @param {Array<Node|string|null|undefined>|Node|string} [kids]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n[k] = v;
  }
  for (const c of [].concat(kids)) if (c) n.append(c);
  return n;
}

/**
 * Applique la géométrie calculée au rendu (data-top, data-height, data-lane…) via le CSSOM.
 * La CSP interdit les attributs style="" : les positions passent par ici.
 * @param {ParentNode} root
 */
export function applyGeometry(root) {
  const all = (sel) => /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(sel));
  for (const e of all("[data-top]")) e.style.top = `${e.dataset.top}px`;
  for (const e of all("[data-height]")) e.style.height = `${e.dataset.height}px`;
  for (const e of all("[data-pct]")) e.style.width = `${e.dataset.pct}%`;
  for (const e of all("[data-lanes]")) {
    const n = Number(e.dataset.lanes) || 1;
    e.style.left = `calc(${e.dataset.lane} / ${n} * 100% + 2px)`;
    e.style.width = `calc(100% / ${n} - 4px)`;
  }
}

/** Bouton en deux temps pour les actions destructives : 1er clic = armer, 2e = confirmer. */
export function arm(btn, label) {
  btn.classList.add("armed");
  btn.dataset.armed = "1";
  btn.textContent = label;
}
export function disarm(btn, label) {
  btn.classList.remove("armed");
  delete btn.dataset.armed;
  btn.textContent = label;
}
export const isArmed = (btn) => !!btn.dataset.armed;

/** Donne le focus après l'ouverture d'une fenêtre (laisse le temps à l'affichage). */
export const focusSoon = (target) => setTimeout(() => target?.focus(), 30);

// ------------------------------------------------------------ Fenêtres modales
/** @type {Map<string, () => void>} */
const dialogs = new Map();

/**
 * Déclare une fenêtre modale : clic sur le fond ou Échap la ferment.
 * @param {string} scrimId  id du fond (.scrim)
 * @param {() => void} close
 */
export function registerDialog(scrimId, close) {
  dialogs.set(scrimId, close);
  const scrim = $(scrimId);
  scrim.addEventListener("mousedown", (e) => {
    if (e.target !== scrim) return;
    // Sans l'action par défaut : le navigateur retirerait le focus juste après qu'on l'a rendu
    // à l'élément d'où la fenêtre a été ouverte.
    e.preventDefault();
    close();
  });
}

/** Ferme la fenêtre ouverte, s'il y en a une. @returns {boolean} une fenêtre a été fermée */
export function closeOpenDialog() {
  for (const [id, close] of dialogs) {
    if (!$(id).hidden) {
      close();
      return true;
    }
  }
  return false;
}

export const anyDialogOpen = () => !!document.querySelector(".scrim:not([hidden])");

// ------------------------------------------------------------ Retrouver un élément
// Le planning est redessiné en remplaçant son HTML : pour rendre le focus à un élément, il faut
// de quoi retrouver son équivalent dans le nouveau rendu.

/** Attributs data-* qui portent la géométrie du rendu : ils ne désignent rien. */
const GEOMETRY = ["top", "height", "lane", "lanes", "pct"];
/** Régions qui montrent chacune leur exemplaire d'un même élément (le mois et « À venir », par exemple). */
const REGIONS = ".agenda, .month, .dayp, .wlist";

/**
 * Sélecteurs CSS de l'équivalent de `el` dans un autre rendu, du plus précis au plus souple :
 * d'abord le même élément le même jour, puis le même élément un autre jour (il a pu être déplacé).
 * Toujours dans la même région de la page. Vide si rien ne l'identifie.
 * @param {HTMLElement} el
 * @returns {string[]}
 */
export function selectorsOf(el) {
  if (el.id) return [`#${CSS.escape(el.id)}`];
  const data = Object.entries(el.dataset).filter(([k]) => !GEOMETRY.includes(k));
  if (!data.length) return [];
  const attr = ([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(v ?? "")}"]`;
  const holder = el.parentElement?.closest(`${REGIONS}, [id]`);
  const scope = !holder ? "" : holder.id ? `#${CSS.escape(holder.id)} ` : `.${CSS.escape(holder.classList[0])} `;
  // La classe distingue la case à cocher du titre d'un même élément.
  const own = `${scope}${el.tagName.toLowerCase()}${el.classList.length ? `.${CSS.escape(el.classList[0])}` : ""}`;
  const exact = own + data.map(attr).join("");
  const anyDay =
    own +
    data
      .filter(([k]) => k !== "day")
      .map(attr)
      .join("");
  return "open" in el.dataset && anyDay !== exact ? [exact, anyDay] : [exact];
}

// ------------------------------------------------------------ Retour du focus
// Au clavier, fermer une fenêtre doit ramener là d'où on l'a ouverte, et non en haut de la page.

/**
 * @param {Element | null} el  élément qui a le focus
 * @returns {(() => HTMLElement | null) | null}  de quoi le retrouver plus tard, s'il est encore affiché
 */
function locatorOf(el) {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  // Une entrée du menu disparaît avec lui : on revient au bouton qui l'ouvre.
  const selectors = el.closest("#menu") ? ["#menuBtn"] : selectorsOf(el);
  if (!selectors.length) return null;
  return () => {
    for (const selector of selectors) {
      const found = document.querySelector(selector);
      if (found instanceof HTMLElement && found.getClientRects().length) return found;
    }
    return null;
  };
}

/** Rend le focus à l'élément d'origine quand la dernière fenêtre se ferme (appelé une fois au démarrage). */
export function initFocusReturn() {
  /** @type {(() => HTMLElement | null) | null} */
  let origin = null;
  let wasOpen = false;
  // Les changements d'un même geste arrivent groupés : passer du détail au formulaire
  // (une fenêtre se ferme, l'autre s'ouvre) ne compte pas comme une fermeture.
  const observer = new MutationObserver(() => {
    const open = anyDialogOpen();
    if (open && !wasOpen) origin = locatorOf(document.activeElement);
    if (!open && wasOpen) {
      // Sans défilement : la page ne doit pas bouger parce qu'une fenêtre s'est fermée.
      origin?.()?.focus({ preventScroll: true });
      origin = null;
    }
    wasOpen = open;
  });
  for (const scrim of document.querySelectorAll(".scrim"))
    observer.observe(scrim, { attributes: true, attributeFilter: ["hidden"] });
}
