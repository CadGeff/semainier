// Semainier — couche de stockage. Trois modes derrière la même interface :
//   "supabase" : Postgres + Auth (production)
//   "demo"     : localStorage, avec l'URL #demo (démo publique, aucun appel réseau)
//   "local"    : localStorage, quand config.js est vide
// Deux implémentations : Supabase, et localStorage pour la démo comme pour le mode local.
// Lectures et écritures passent par les mêmes méthodes, quel que soit le mode.

import { toFrench, isMissingTable } from "./errors.js";

/** @import { Item } from "./items.js" */

/**
 * @typedef {object} MfaStatus
 * @property {boolean} enabled    un facteur TOTP vérifié existe
 * @property {string|null} factorId
 * @property {boolean} needsCode  la session actuelle doit encore valider un code
 */

const cfg = window.SEMAINIER_CONFIG || {};

/** Détecte une clé à privilèges (secret / service_role) mise par erreur dans config.js. */
function isPrivilegedKey(key) {
  if (/^sb_secret_/.test(key)) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return json.role === "service_role";
  } catch {
    return false;
  }
}

const STORAGE_FULL = "Le navigateur refuse d'enregistrer (navigation privée ou stockage plein).";

// ------------------------------------------------------------ Local et démo
// Même code, clé de stockage différente : la démo ne touche jamais aux données locales.
function makeLocalStore(mode, key) {
  /** @type {Item[] | null} */
  let items = null;
  const write = () => {
    try {
      localStorage.setItem(key, JSON.stringify(items || []));
    } catch {
      throw new Error(STORAGE_FULL);
    }
  };
  return {
    mode,
    async init() {
      return { signedIn: true, email: null };
    },
    async signOut() {
      return true;
    },
    onSignedOut() {},
    /** @returns {Promise<Item[] | null>} null si rien n'a jamais été enregistré */
    async list() {
      try {
        const raw = localStorage.getItem(key);
        items = raw ? JSON.parse(raw) : null;
      } catch {
        items = null;
      }
      return items ? items.map((x) => ({ ...x })) : null;
    },
    /** @param {Item} item */
    async save(item) {
      items = items || [];
      const i = items.findIndex((x) => x.id === item.id);
      if (i >= 0) items[i] = { ...item };
      else items.push({ ...item });
      write();
    },
    /** @param {Item[]} list */
    async saveMany(list) {
      for (const it of list) await this.save(it);
    },
    /** @param {string} id */
    async remove(id) {
      items = (items || []).filter((x) => x.id !== id);
      write();
    },
    async clear() {
      items = null;
      try {
        localStorage.removeItem(key);
        localStorage.removeItem(`${key}.settings`);
      } catch {
        /* rien à effacer */
      }
    },
    async getSettings() {
      try {
        const raw = localStorage.getItem(`${key}.settings`);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async saveSettings(s) {
      try {
        localStorage.setItem(`${key}.settings`, JSON.stringify(s));
      } catch {
        throw new Error(STORAGE_FULL);
      }
    },
  };
}

// ------------------------------------------------------------------ Supabase
const COLS = "id,title,kind,start_date,until_date,time_from,time_to,recur,days,cat,done,skipped";

/** @param {Item} it */
const toRow = (it) => ({
  id: it.id,
  title: it.title,
  kind: it.kind,
  start_date: it.start,
  until_date: it.recur && it.recur !== "none" && it.until ? it.until : null,
  time_from: it.from || null,
  time_to: it.to || null,
  recur: it.recur || "none",
  days: it.recur === "weekly" ? it.days || [] : null,
  cat: it.cat || "bleu",
  done: it.done || {},
  skipped: it.skipped || {},
});

/** @returns {Item} */
const fromRow = (r) => {
  /** @type {Item} */
  const it = {
    id: r.id,
    title: r.title,
    kind: r.kind,
    start: r.start_date,
    recur: r.recur,
    cat: r.cat,
    done: r.done || {},
    skipped: r.skipped || {},
  };
  if (r.time_from && r.time_to) {
    it.from = r.time_from.slice(0, 5);
    it.to = r.time_to.slice(0, 5);
  }
  if (r.days) it.days = r.days;
  if (r.until_date && r.recur !== "none") it.until = r.until_date;
  return it;
};

function makeSupabaseStore() {
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const auth = client.auth;
  /** @type {Array<() => void>} */
  const signedOutHandlers = [];
  let uid = null;
  auth.onAuthStateChange((event, session) => {
    uid = session?.user?.id ?? null;
    if (event === "SIGNED_OUT") signedOutHandlers.forEach((fn) => fn());
  });
  /** Lève l'erreur Supabase traduite, sinon renvoie les données. */
  const check = ({ data, error }) => {
    if (error) throw toFrench(error);
    return data;
  };
  /** Comme `check`, pour la table items : une colonne absente a un message qui dit quoi faire. */
  const checkItems = (res) => {
    if (res.error && isMissingTable(res.error))
      throw new Error(
        "La base de données n'est pas à jour : relance supabase/schema.sql dans le SQL Editor de Supabase, puis recharge la page.",
      );
    return check(res);
  };

  return {
    mode: "supabase",
    async init() {
      const { data } = await auth.getSession();
      const s = data?.session;
      uid = s?.user?.id ?? null;
      return { signedIn: !!s, email: s?.user?.email ?? null };
    },
    async signIn(email, password) {
      const data = check(await auth.signInWithPassword({ email, password }));
      uid = data.user?.id;
      return { email: data.user?.email };
    },
    /**
     * Portée « global » : la déconnexion ferme la session sur tous les appareils.
     * Si le serveur ne confirme pas, cet appareil est quand même déconnecté (sauf session
     * illisible), mais les autres ne le sont pas.
     * @returns {Promise<boolean>} false si les autres appareils n'ont pas pu être déconnectés
     */
    async signOut() {
      try {
        const { error } = await auth.signOut({ scope: "global" });
        return !error;
      } catch {
        return false;
      }
    },
    /**
     * Ferme les autres sessions (après un changement de mot de passe ou l'activation de la 2FA).
     * Non bloquant : l'opération principale a déjà réussi.
     * @returns {Promise<boolean>} false si le serveur n'a pas confirmé
     */
    async signOutOthers() {
      try {
        const { error } = await auth.signOut({ scope: "others" });
        return !error;
      } catch {
        return false;
      }
    },
    onSignedOut(fn) {
      signedOutHandlers.push(fn);
    },
    /** @returns {Promise<boolean>} false si les autres sessions n'ont pas pu être fermées */
    async changePassword(password) {
      check(await auth.updateUser({ password }));
      // Un appareil volé ou oublié perd l'accès.
      return this.signOutOthers();
    },

    // ----- Double authentification (TOTP), optionnelle
    /** @returns {Promise<MfaStatus>} */
    async mfaStatus() {
      const aal = check(await auth.mfa.getAuthenticatorAssuranceLevel());
      // listFactors interroge le serveur : détecte aussi une 2FA activée depuis un autre appareil.
      const factors = check(await auth.mfa.listFactors());
      const verified = factors?.totp || [];
      const enabled = verified.length > 0;
      return {
        enabled,
        factorId: enabled ? verified[0].id : null,
        needsCode: enabled && aal.currentLevel !== "aal2",
      };
    },
    async mfaEnroll() {
      // Nettoie un enrôlement abandonné (facteur non vérifié), sinon Supabase refuse le nouveau.
      const { data } = await auth.mfa.listFactors();
      for (const f of data?.all || []) {
        if (f.factor_type === "totp" && f.status !== "verified") await auth.mfa.unenroll({ factorId: f.id });
      }
      const en = check(await auth.mfa.enroll({ factorType: "totp", friendlyName: "Semainier", issuer: "Semainier" }));
      return { factorId: en.id, qr: en.totp.qr_code, secret: en.totp.secret };
    },
    async mfaVerify(factorId, code) {
      check(await auth.mfa.challengeAndVerify({ factorId, code }));
    },
    async mfaDisable(factorId) {
      check(await auth.mfa.unenroll({ factorId }));
      await auth.refreshSession().catch(() => {});
    },

    // ----- Données
    async list() {
      return checkItems(await client.from("items").select(COLS).order("created_at", { ascending: true })).map(fromRow);
    },
    async save(item) {
      checkItems(await client.from("items").upsert(toRow(item)));
    },
    async saveMany(items) {
      if (items.length) checkItems(await client.from("items").upsert(items.map(toRow)));
    },
    async remove(id) {
      check(await client.from("items").delete().eq("id", id));
    },
    async clear() {},
    /** Réglages synchronisés (noms des catégories). null si rien n'est enregistré. */
    async getSettings() {
      const { data, error } = await client.from("settings").select("cat_labels").maybeSingle();
      if (error && isMissingTable(error))
        throw new Error(
          "Noms des catégories non synchronisés : relance supabase/schema.sql dans le SQL Editor de Supabase.",
        );
      if (error) throw toFrench(error);
      return data ? { catLabels: data.cat_labels || {} } : null;
    },
    async saveSettings(s) {
      check(
        await client
          .from("settings")
          .upsert({ user_id: uid, cat_labels: s.catLabels || {} }, { onConflict: "user_id" }),
      );
    },
  };
}

// ------------------------------------------------------------------ Choix
function pick() {
  // #demo dans l'URL : démo publique, données d'exemple dans le navigateur, aucun appel à Supabase.
  if (location.hash === "#demo") return { store: makeLocalStore("demo", "semainier.demo.v1"), error: null };
  const local = makeLocalStore("local", "semainier.items.v1");
  if (!cfg.supabaseUrl && !cfg.supabaseKey) return { store: local, error: null };
  if (!cfg.supabaseUrl || !cfg.supabaseKey)
    return { store: local, error: "config.js : il faut à la fois supabaseUrl et supabaseKey." };
  if (isPrivilegedKey(cfg.supabaseKey))
    return {
      store: local,
      error:
        "config.js contient une clé secrète (service_role / sb_secret). Remplace-la par la clé publishable ou anon, et régénère la clé secrète dans Supabase.",
    };
  if (!window.supabase) return { store: local, error: "Le client Supabase n'a pas pu être chargé (vendor/)." };
  return { store: makeSupabaseStore(), error: null };
}

const picked = pick();

/**
 * Stockage actif. Les méthodes propres à Supabase (signIn, mfa…) n'existent qu'en mode "supabase".
 * @type {ReturnType<typeof makeLocalStore> & Partial<ReturnType<typeof makeSupabaseStore>>}
 */
export const Store = picked.store;
/** Problème de configuration à signaler à l'écran (le site retombe alors en mode local). */
export const configError = picked.error;
