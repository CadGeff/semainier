// Menu ⋯ : sauvegarde (export / import JSON), démo, thème, compte.

import { ds } from "./recurrence.js";
import { DEFAULT_LABELS, cleanLabels, sample } from "./items.js";
import {
  MAX_FILE_BYTES,
  backupReminder,
  buildExport,
  isDefaultLabels,
  readExport,
  withoutDuplicates,
} from "./backup.js";
import { Store } from "./store.js";
import { state, clone, render, setStatus, tracked, todayDate } from "./state.js";
import { $, field } from "./dom.js";
import { scrollToNow } from "./board.js";
import { openCats } from "./categories.js";
import { openPw, openMfa } from "./account.js";
import { signOut } from "./session.js";

const menuBtn = $("menuBtn");
const menu = $("menu");
const menuItems = () => /** @type {HTMLElement[]} */ ([...menu.querySelectorAll('[role^="menuitem"]:not([hidden])')]);
const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;

export const isMenuOpen = () => !menu.hidden;

function openMenu() {
  syncBackupNote();
  menu.hidden = false;
  menuBtn.setAttribute("aria-expanded", "true");
  menuItems()[0]?.focus();
}

/** @param {boolean} [focusBtn] rendre le focus au bouton ⋯ (fermeture au clavier) */
export function closeMenu(focusBtn = false) {
  if (menu.hidden) return;
  menu.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
  if (focusBtn) menuBtn.focus();
}

/** Affiche les entrées propres au mode (démo, local, Supabase). */
export function syncMenu() {
  const demo = Store.mode === "demo";
  const supa = Store.mode === "supabase";
  $("m-reset").hidden = !demo;
  $("m-exit").hidden = !demo;
  $("m-logout").hidden = !supa;
  $("m-password").hidden = !supa;
  $("m-mfa").hidden = !supa;
  $("m-who").textContent = demo
    ? "Démo : rien n'est envoyé à un serveur."
    : supa
      ? `Connecté : ${state.email || "compte Supabase"}`
      : "Mode local : données dans ce navigateur.";
  syncBackupNote();
}

// ------------------------------------------------------------ Export / import
// Date du dernier export fait sur cet appareil : c'est ici que se trouve le fichier.
const LAST_EXPORT_KEY = "semainier.lastExport";

function lastExport() {
  try {
    return localStorage.getItem(LAST_EXPORT_KEY);
  } catch {
    return null;
  }
}

/** Ligne « Dernière sauvegarde » du menu, et pastille sur le bouton ⋯ quand elle date. */
function syncBackupNote() {
  const demo = Store.mode === "demo";
  const reminder = backupReminder(lastExport());
  const late = !demo && reminder.late;
  const note = $("m-backup");
  note.hidden = demo;
  note.textContent = demo ? "" : reminder.text;
  note.classList.toggle("late", late);
  menuBtn.classList.toggle("has-note", late);
  menuBtn.setAttribute("aria-label", late ? "Plus d'options (sauvegarde à refaire)" : "Plus d'options");
}

/**
 * Noms de catégories à reprendre du fichier, ou null. Ils ne remplacent jamais des noms
 * personnalisés : on relit ceux du stockage, sans se fier à l'affichage, qui retombe sur
 * les noms par défaut quand leur chargement a échoué.
 * @param {Record<string, string> | null} fromFile
 */
async function labelsToRestore(fromFile) {
  if (!fromFile || isDefaultLabels(fromFile) || !isDefaultLabels(state.labels)) return null;
  try {
    const saved = cleanLabels((await Store.getSettings())?.catLabels);
    return isDefaultLabels(saved) ? fromFile : null;
  } catch {
    return null;
  }
}

const NOT_LOADED = "Le planning n'est pas chargé : réessaie dans un instant, ou recharge la page.";

function exportJson() {
  closeMenu(true);
  // Tant que le planning n'a pas été lu, la mémoire est vide : l'export le serait aussi.
  if (!state.hasData) return setStatus(NOT_LOADED, true);
  const data = buildExport(state.items.map(clone), state.labels);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `semainier-${ds(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (Store.mode !== "demo") {
    try {
      localStorage.setItem(LAST_EXPORT_KEY, data.exportedAt);
    } catch {
      /* stockage indisponible : pas de rappel sur cet appareil */
    }
    syncBackupNote();
  }
  setStatus(`Sauvegarde téléchargée (${plural(data.items.length, "élément")}).`);
}

/**
 * Importe une sauvegarde : chaque élément est revalidé, les invalides sont ignorés,
 * et ceux que le planning contient déjà ne sont pas ajoutés une seconde fois.
 * L'affichage n'est modifié qu'une fois l'écriture réussie : après un échec,
 * relancer le même import reprend là où il s'est arrêté.
 * @param {File} file
 */
async function importJson(file) {
  // La comparaison avec un planning pas encore lu ne verrait aucun doublon.
  if (!state.hasData) return setStatus(NOT_LOADED, true);
  if (file.size > MAX_FILE_BYTES) return setStatus("Fichier trop volumineux (2 Mo maximum).", true);
  const read = readExport(await file.text());
  if (read.ok === false) return setStatus(read.error, true);
  const labels = await labelsToRestore(read.labels);
  if (!read.items.length && !labels) return setStatus("Aucun élément valide dans ce fichier.", true);
  const { fresh, duplicates } = withoutDuplicates(read.items, state.items);
  // Le résultat d'un import reste affiché jusqu'au clic sur « OK ».
  if (!fresh.length && !labels)
    return setStatus("Rien à importer : toute la sauvegarde est déjà dans ton planning.", false, true);
  await tracked(async () => {
    if (fresh.length) {
      await Store.saveMany(fresh.map(clone));
      state.items.push(...fresh);
      render();
    }
    if (labels) {
      await Store.saveSettings({ catLabels: labels });
      state.labels = labels;
      render();
    }
  });
  const s = fresh.length > 1 ? "s" : "";
  const parts = fresh.length ? [`${fresh.length} élément${s} importé${s}`] : [];
  if (duplicates) parts.push(`${duplicates} déjà présent${duplicates > 1 ? "s" : ""}`);
  if (read.invalid) parts.push(`${read.invalid} invalide${read.invalid > 1 ? "s ignorés" : " ignoré"}`);
  if (labels) parts.push("noms des catégories restaurés");
  const msg = parts.join(", ");
  setStatus(`${msg[0].toUpperCase()}${msg.slice(1)}.`, false, true);
}

// ------------------------------------------------------------------ Démo
export async function resetDemo() {
  closeMenu();
  await Store.clear();
  state.labels = { ...DEFAULT_LABELS };
  state.focusCat = null;
  state.items = sample();
  await Store.saveMany(state.items.map(clone));
  state.sel = todayDate();
  state.pick = null;
  setStatus("Démo réinitialisée.");
  render();
  scrollToNow();
}

// ------------------------------------------------------------------ Thème
// Réglage propre à chaque appareil : Auto (suit le système), Clair ou Sombre.
const THEME_KEY = "semainier.theme";

function currentTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "auto";
}

/** @param {"auto"|"light"|"dark"|string} t */
function applyTheme(t) {
  const root = document.documentElement;
  if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
  else root.removeAttribute("data-theme");
  try {
    if (t === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* stockage indisponible : réglage non mémorisé */
  }
  for (const b of menu.querySelectorAll("[data-theme-set]")) {
    b.setAttribute("aria-checked", String(/** @type {HTMLElement} */ (b).dataset.themeSet === t));
  }
}

export function initMenu() {
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  };
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !(/** @type {HTMLElement} */ (e.target).closest(".menu-wrap"))) closeMenu();
  });
  menu.addEventListener("keydown", (e) => {
    const list = menuItems();
    const i = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length].focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length].focus();
    }
    if (e.key === "Tab") closeMenu();
  });

  $("m-export").onclick = exportJson;
  $("m-import").onclick = () => {
    closeMenu();
    $("importFile").click();
  };
  const fileInput = field("importFile");
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) importJson(file).catch((err) => setStatus(err?.message || "Import impossible.", true));
  };
  $("m-cats").onclick = openCats;
  $("m-reset").onclick = resetDemo;
  $("m-exit").onclick = () => {
    location.hash = "";
  };
  $("m-password").onclick = openPw;
  $("m-mfa").onclick = openMfa;
  $("m-logout").onclick = () => {
    closeMenu();
    signOut();
  };
  for (const b of menu.querySelectorAll("[data-theme-set]")) {
    /** @type {HTMLElement} */ (b).onclick = () => applyTheme(/** @type {HTMLElement} */ (b).dataset.themeSet);
  }
  applyTheme(currentTheme());
  // Un onglet laissé ouvert plusieurs semaines doit quand même afficher le rappel.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncBackupNote();
  });
  // Entrer dans la démo ou en sortir change de mode de stockage : on recharge.
  window.addEventListener("hashchange", () => location.reload());
}
