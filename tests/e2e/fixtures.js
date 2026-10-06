// Outils partagés des tests E2E : simulation de Supabase (Auth + REST) et collecte des erreurs.
import { test as base, expect } from "@playwright/test";

export const SUPABASE = "https://igyoyutosvkbeeiriwyf.supabase.co";
export const USER_ID = "11111111-1111-1111-1111-111111111111";
export const EMAIL = "utilisateur@example.com";
export const PASSWORD = "mot-de-passe-de-test";
export const TOTP = "123456";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** Jeton factice : supabase-js ne vérifie pas la signature, seulement le contenu (aal, exp). */
const jwt = (aal) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    sub: USER_ID,
    aal,
    amr: [{ method: aal === "aal2" ? "totp" : "password", timestamp: 1 }],
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: "authenticated",
  })}.${Buffer.from("signature").toString("base64url")}`;

const QR = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>';

/**
 * Simule un projet Supabase. `state` décrit le compte (facteurs 2FA, niveau de session, éléments)
 * et garde la trace des requêtes reçues pour les assertions.
 */
export async function mockSupabase(page, init = {}) {
  const state = {
    factors: [],
    aal: "aal1",
    items: [],
    settings: null,
    log: [],
    samePasswordOnce: false,
    // Nombre de requêtes à faire échouer (panne passagère) : { itemsGet, itemsPost, logout }.
    // supabase-js retente seul une lecture en échec : une seule panne en lecture reste invisible.
    fail: {},
    slowItemsGet: 0,
    key: "sb_publishable_test",
    ...init,
  };
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.SEMAINIER_CONFIG = { supabaseUrl: "${SUPABASE}", supabaseKey: "${state.key}" };`,
    }),
  );
  const user = () => ({
    id: USER_ID,
    email: EMAIL,
    aud: "authenticated",
    role: "authenticated",
    factors: state.factors,
  });
  const session = () => ({
    access_token: jwt(state.aal),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "refresh",
    user: user(),
  });
  // Comme le vrai serveur : la version d'API annoncée en en-tête indique à supabase-js
  // de lire le code d'erreur dans le champ `code`.
  const headers = {
    "x-supabase-api-version": "2024-01-01",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "x-supabase-api-version",
  };
  const json = (route, status, body) =>
    route.fulfill({
      status,
      headers,
      contentType: "application/json",
      body: body === undefined || body === "" ? "" : JSON.stringify(body),
    });
  const mfaOk = () => !state.factors.some((f) => f.status === "verified") || state.aal === "aal2";

  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();
    const body = req.postDataJSON?.() ?? null;
    state.log.push({ method: m, path: p, search: url.search, body });
    let x;

    if (p === "/auth/v1/token") {
      if (body?.password !== PASSWORD)
        return json(route, 400, { code: "invalid_credentials", msg: "Invalid login credentials" });
      return json(route, 200, session());
    }
    if (p === "/auth/v1/user" && m === "GET") return json(route, 200, user());
    if (p === "/auth/v1/user" && m === "PUT") {
      if (state.samePasswordOnce) {
        state.samePasswordOnce = false;
        return json(route, 422, {
          code: "same_password",
          msg: "New password should be different from the old password.",
        });
      }
      return json(route, 200, user());
    }
    if (p === "/auth/v1/logout") {
      if (state.fail.logout > 0) {
        state.fail.logout--;
        return json(route, 503, { message: "Service Unavailable" });
      }
      return route.fulfill({ status: 204, body: "" });
    }
    if (p === "/auth/v1/factors" && m === "POST") {
      state.factors.push({
        id: "factor-1",
        factor_type: "totp",
        status: "unverified",
        friendly_name: body.friendly_name,
      });
      return json(route, 200, {
        id: "factor-1",
        type: "totp",
        totp: { qr_code: QR, secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Semainier" },
      });
    }
    if ((x = p.match(/^\/auth\/v1\/factors\/([\w-]+)\/challenge$/)))
      return json(route, 200, { id: "challenge-1", type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
    if ((x = p.match(/^\/auth\/v1\/factors\/([\w-]+)\/verify$/))) {
      if (body?.code !== TOTP)
        return json(route, 422, { code: "mfa_verification_failed", msg: "Invalid TOTP code entered" });
      state.factors.forEach((f) => {
        if (f.id === x[1]) f.status = "verified";
      });
      state.aal = "aal2";
      return json(route, 200, session());
    }
    if ((x = p.match(/^\/auth\/v1\/factors\/([\w-]+)$/)) && m === "DELETE") {
      state.factors = state.factors.filter((f) => f.id !== x[1]);
      state.aal = "aal1";
      return json(route, 200, { id: x[1] });
    }
    // REST : reproduit la politique RLS restrictive (rien sans aal2 quand la 2FA est active).
    if (p === "/rest/v1/items") {
      if (!mfaOk())
        return json(
          route,
          m === "GET" ? 200 : 403,
          m === "GET" ? [] : { code: "42501", message: "new row violates row-level security policy" },
        );
      const outage = m === "GET" ? "itemsGet" : m === "POST" ? "itemsPost" : null;
      if (outage && state.fail[outage] > 0) {
        state.fail[outage]--;
        return json(route, 503, { message: "Service Unavailable" });
      }
      if (m === "GET") {
        // Réseau lent : la réponse attend `slowItemsGet` millisecondes.
        if (state.slowItemsGet) await new Promise((done) => setTimeout(done, state.slowItemsGet));
        // Comme PostgREST : seules les colonnes demandées par `select` sont renvoyées.
        const select = url.searchParams.get("select");
        const cols = select && select !== "*" ? select.split(",") : null;
        const rows = cols
          ? state.items.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))
          : state.items;
        return json(route, 200, rows);
      }
      if (m === "POST") {
        for (const row of [].concat(body)) {
          const i = state.items.findIndex((r) => r.id === row.id);
          if (i >= 0) state.items[i] = row;
          else state.items.push(row);
        }
        return json(route, 201, "");
      }
      if (m === "DELETE") {
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        state.items = state.items.filter((r) => r.id !== id);
        return route.fulfill({ status: 204, body: "" });
      }
    }
    if (p === "/rest/v1/settings") {
      // Même politique restrictive que sur items : aucune ligne lue, écriture refusée.
      if (!mfaOk())
        return m === "GET"
          ? route.fulfill({ status: 200, contentType: "application/json", body: "null" })
          : json(route, 403, { code: "42501", message: "new row violates row-level security policy" });
      if (m === "GET")
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.settings) });
      state.settings = { cat_labels: body.cat_labels };
      return json(route, 201, "");
    }
    return json(route, 404, { message: `Route non simulée : ${m} ${p}` });
  });
  return state;
}

/** Se connecte avec l'e-mail et le mot de passe de test. */
export async function login(page, password = PASSWORD) {
  await page.goto("/");
  await page.getByLabel("E-mail", { exact: true }).fill(EMAIL);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

/**
 * Fixture `errors` : erreurs JavaScript et violations de CSP relevées pendant le test.
 * Chaque test peut vérifier `expect(errors).toEqual([])`.
 */
export const test = base.extend({
  errors: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (/Content Security Policy|Refused to/i.test(msg.text())) errors.push(`csp: ${msg.text()}`);
    });
    await use(errors);
  },
});

export { expect };
