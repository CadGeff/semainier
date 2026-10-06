// Règles de la base, exécutées pour de vrai : supabase/schema.sql est appliqué à un Postgres
// embarqué (PGlite), puis interrogé comme le ferait l'API Supabase, rôle par rôle.
//
// Ce qui est simulé : les rôles « anon » et « authenticated », le schéma « auth » et le contenu
// du jeton (auth.uid(), auth.jwt()). Ce qui est réel : les tables, les contraintes, les droits,
// les politiques RLS et la fonction de contrôle de la 2FA, tels qu'ils sont dans le dépôt.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const schema = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

/**
 * Ce que Supabase fournit avant notre script. Comme chez Supabase, toute table créée dans
 * « public » est ouverte par défaut aux rôles de l'API : c'est au script de refermer.
 * L'API n'a en revanche aucun droit sur auth.mfa_factors.
 */
const SUPABASE_LIKE = `
  create role anon nologin;
  create role authenticated nologin;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table auth.mfa_factors (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id),
    status text not null
  );
  create function auth.jwt() returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
`;

async function freshDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_LIKE);
  return db;
}

/** @type {PGlite} */
let db;

/**
 * Exécute une requête avec le rôle et le jeton d'une session, comme le fait l'API.
 * @param {"anon" | "authenticated"} role
 * @param {object} claims  contenu du jeton : { sub, aal }
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function as(role, claims, sql, params = []) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const alice = (sql, params, aal = "aal1") => as("authenticated", { sub: ALICE, aal }, sql, params);
const bob = (sql, params, aal = "aal1") => as("authenticated", { sub: BOB, aal }, sql, params);
const anon = (sql, params) => as("anon", {}, sql, params);

/** État réel des données d'Alice, lu sans passer par les politiques. */
async function aliceData() {
  const items = await db.query("select title from public.items where user_id = $1 order by title", [ALICE]);
  const settings = await db.query("select cat_labels ->> 'bleu' as bleu from public.settings where user_id = $1", [
    ALICE,
  ]);
  return { titles: items.rows.map((r) => r.title), bleu: settings.rows[0]?.bleu };
}

const INSERT_TASK = "insert into public.items (title, kind, start_date) values ($1, 'task', '2026-10-01') returning id";
/** Insère un élément au nom d'Alice avec les colonnes données ; doit être refusé par une contrainte. */
const rejectsItem = (columns, values, pattern = /violates check constraint/) =>
  assert.rejects(alice(`insert into public.items (${columns}) values (${values})`), pattern);

before(async () => {
  db = await freshDatabase();
  await db.query("insert into auth.users values ($1), ($2)", [ALICE, BOB]);
  await db.exec(schema);
});

after(async () => {
  await db.close();
});

test("schéma : le script se relance sans erreur et sans rien perdre", async () => {
  await alice(INSERT_TASK, ["Relance"]);
  await db.exec(schema);
  await db.exec(schema);
  const rows = await alice("select title from public.items where title = 'Relance'");
  assert.equal(rows.length, 1);
  await alice("delete from public.items where title = 'Relance'");
});

test("schéma : une base créée avec une ancienne version est mise à niveau", async () => {
  const old = await freshDatabase();
  try {
    // Jusqu'à la v1.2.0, items avait sa propre fonction de déclencheur.
    await old.exec(schema);
    await old.exec(`
      create function public.items_touch_updated_at() returns trigger language plpgsql set search_path = ''
        as $$ begin new.updated_at := now(); return new; end; $$;
      drop trigger items_touch_updated_at on public.items;
      create trigger items_touch_updated_at before update on public.items
        for each row execute function public.items_touch_updated_at();
    `);
    await old.exec(schema);
    const { rows } = await old.query(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1",
    );
    assert.deepEqual(
      rows.map((r) => r.proname),
      ["touch_updated_at"],
    );
  } finally {
    await old.close();
  }
});

test("schéma : une base d'avant la date de fin reçoit la colonne sans perdre ses lignes", async () => {
  const old = await freshDatabase();
  try {
    await old.query("insert into auth.users values ($1)", [ALICE]);
    // Jusqu'à la v1.3.0, items n'avait pas de colonne until_date.
    await old.exec(schema);
    await old.exec(`
      alter table public.items drop constraint items_until_ok;
      alter table public.items drop column until_date;
    `);
    await old.query(
      "insert into public.items (user_id, title, kind, start_date, recur) values ($1, 'Lecture', 'task', '2026-09-28', 'daily')",
      [ALICE],
    );
    await old.exec(schema);
    const { rows } = await old.query("select title, recur, until_date from public.items");
    assert.deepEqual(rows, [{ title: "Lecture", recur: "daily", until_date: null }]);
    // La contrainte est bien revenue avec la colonne.
    await assert.rejects(
      old.query("update public.items set until_date = '2026-09-01'"),
      /violates check constraint "items_until_ok"/,
    );
  } finally {
    await old.close();
  }
});

test("schéma : updated_at est posé par la base sur les deux tables", async () => {
  await alice(INSERT_TASK, ["Horodatage"]);
  await alice("insert into public.settings (cat_labels) values ('{}')");
  await db.exec("alter table public.items disable trigger user; alter table public.settings disable trigger user");
  await db.exec(
    "update public.items set updated_at = '2000-01-01'; update public.settings set updated_at = '2000-01-01'",
  );
  await db.exec("alter table public.items enable trigger user; alter table public.settings enable trigger user");
  // Même une date envoyée par le client est remplacée.
  const [item] = await alice(
    "update public.items set title = 'Horodatage 2', updated_at = '1999-01-01' where title = 'Horodatage' returning updated_at",
  );
  const [settings] = await alice(`update public.settings set cat_labels = '{"bleu":"Travail"}' returning updated_at`);
  assert.ok(item.updated_at.getFullYear() >= 2026);
  assert.ok(settings.updated_at.getFullYear() >= 2026);
  await alice("delete from public.items where title = 'Horodatage 2'");
  await alice("delete from public.settings");
});

test("schéma : les fonctions ont un search_path vide, et RLS est active sur les deux tables", async () => {
  const fns = await db.query(
    `select n.nspname || '.' || p.proname as name, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')`,
  );
  assert.equal(fns.rows.length, 2);
  for (const f of fns.rows) assert.deepEqual(f.proconfig, ['search_path=""'], f.name);
  const tables = await db.query(
    "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1",
  );
  assert.deepEqual(tables.rows, [
    { relname: "items", relrowsecurity: true },
    { relname: "settings", relrowsecurity: true },
  ]);
});

test("RLS : un visiteur non connecté n'a aucun droit", async () => {
  for (const table of ["items", "settings"]) {
    await assert.rejects(anon(`select * from public.${table}`), /permission denied/);
    await assert.rejects(anon(`delete from public.${table}`), /permission denied/);
  }
  await assert.rejects(anon(INSERT_TASK, ["Intrus"]), /permission denied/);
  await assert.rejects(anon("select private.mfa_satisfied()"), /permission denied/);
  // Deux verrous indépendants sur la fonction de contrôle : le schéma, puis la fonction elle-même.
  const { rows } = await db.query(
    `select has_schema_privilege('anon', 'private', 'usage') as on_schema,
            has_function_privilege('anon', 'private.mfa_satisfied()', 'execute') as on_function`,
  );
  assert.deepEqual(rows, [{ on_schema: false, on_function: false }]);
});

test("RLS : chacun ne lit et ne modifie que ses lignes", async () => {
  const [{ id }] = await alice(INSERT_TASK, ["Rendez-vous"]);
  await alice(`insert into public.settings (cat_labels) values ('{"bleu":"Travail"}')`);

  // Le propriétaire est posé par la base à partir du jeton.
  const owner = await db.query("select user_id from public.items where id = $1", [id]);
  assert.equal(owner.rows[0].user_id, ALICE);

  assert.equal((await alice("select id from public.items")).length, 1);
  assert.deepEqual(await bob("select id from public.items"), []);
  assert.deepEqual(await bob("select user_id from public.settings"), []);
  assert.deepEqual(await bob("update public.items set title = 'Volé' returning id"), []);
  assert.deepEqual(await bob(`update public.settings set cat_labels = '{"bleu":"Volé"}' returning user_id`), []);
  assert.deepEqual(await bob("delete from public.items returning id"), []);
  assert.deepEqual(await bob("delete from public.settings returning user_id"), []);

  // Écritures à l'aveugle, sans rien relire : seules les politiques d'écriture s'appliquent.
  await bob("update public.items set title = 'Volé'");
  await bob(`update public.settings set cat_labels = '{"bleu":"Volé"}'`);
  await bob("delete from public.items");
  await bob("delete from public.settings");
  assert.deepEqual(await aliceData(), { titles: ["Rendez-vous"], bleu: "Travail" });
});

test("RLS : impossible de créer une ligne au nom d'un autre ou de s'en approprier une", async () => {
  await assert.rejects(
    bob("insert into public.items (user_id, title, kind, start_date) values ($1, 'x', 'task', '2026-10-01')", [ALICE]),
    /row-level security/,
  );
  await assert.rejects(bob("insert into public.settings (user_id) values ($1)", [ALICE]), /row-level security/);
  // Alice ne peut pas non plus céder sa ligne à Bob.
  await assert.rejects(alice("update public.items set user_id = $1", [BOB]), /row-level security/);
  // Bob ne voit pas la ligne d'Alice : sa tentative ne touche rien.
  assert.deepEqual(await bob("update public.items set user_id = $1 returning id", [BOB]), []);
});

test("2FA : un facteur non vérifié ne bloque rien", async () => {
  await db.query("insert into auth.mfa_factors (user_id, status) values ($1, 'unverified')", [ALICE]);
  assert.equal((await alice("select id from public.items")).length, 1);
  await db.exec("delete from auth.mfa_factors");
});

test("2FA active : une session sans code ne lit ni n'écrit rien, sur les deux tables", async () => {
  await db.query("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [ALICE]);

  assert.deepEqual(await alice("select id from public.items"), []);
  assert.deepEqual(await alice("select user_id from public.settings"), []);
  assert.deepEqual(await alice("update public.items set title = 'x' returning id"), []);
  assert.deepEqual(await alice("delete from public.items returning id"), []);
  await assert.rejects(alice(INSERT_TASK, ["Sans code"]), /row-level security/);
  assert.deepEqual(await alice("update public.settings set cat_labels = '{}' returning user_id"), []);
  assert.deepEqual(await alice("delete from public.settings returning user_id"), []);
  await assert.rejects(alice("insert into public.settings (cat_labels) values ('{}')"), /row-level security/);

  // Écritures à l'aveugle, sans rien relire : la politique d'écriture refuse aussi.
  await alice("update public.items set title = 'Sans code'");
  await alice(`update public.settings set cat_labels = '{"bleu":"Sans code"}'`);
  await alice("delete from public.items");
  await alice("delete from public.settings");
  await assert.rejects(
    alice("insert into public.items (title, kind, start_date) values ('Sans code', 'task', '2026-10-01')"),
    /row-level security/,
  );
  assert.deepEqual(await aliceData(), { titles: ["Rendez-vous"], bleu: "Travail" });
  // Un jeton sans niveau déclaré est traité comme une session sans code.
  assert.deepEqual(await as("authenticated", { sub: ALICE }, "select id from public.items"), []);

  // Le facteur d'Alice ne concerne qu'elle.
  await bob(INSERT_TASK, ["Tâche de Bob"]);
  assert.equal((await bob("select id from public.items")).length, 1);
});

test("2FA active : la session validée par le code retrouve ses données, et seulement les siennes", async () => {
  const rows = await alice("select title from public.items", [], "aal2");
  assert.deepEqual(rows, [{ title: "Rendez-vous" }]);
  assert.equal((await alice("select user_id from public.settings", [], "aal2")).length, 1);
  const [created] = await alice(INSERT_TASK, ["Avec code"], "aal2");
  assert.ok(created.id);
  await db.exec("delete from auth.mfa_factors");
});

test("contraintes : valeurs autorisées et longueur du titre", async () => {
  await rejectsItem("title, kind, start_date", "'', 'task', '2026-10-01'");
  await rejectsItem("title, kind, start_date", `'${"x".repeat(121)}', 'task', '2026-10-01'`);
  await rejectsItem("title, kind, start_date", "'x', 'note', '2026-10-01'");
  await rejectsItem("title, kind, start_date, recur", "'x', 'task', '2026-10-01', 'yearly'");
  await rejectsItem("title, kind, start_date, cat", "'x', 'task', '2026-10-01', 'violet'");
  await rejectsItem("title, kind, start_date, days", "'x', 'task', '2026-10-01', '{7}'");
  await rejectsItem("title, kind", "'x', 'task'", /null value/);
  await rejectsItem("title, kind, start_date", "'x', 'task', '2026-02-30'", /out of range/);
});

test("contraintes : horaires cohérents", async () => {
  // Les deux heures ou aucune.
  await rejectsItem("title, kind, start_date, time_from", "'x', 'task', '2026-10-01', '09:00'");
  await rejectsItem("title, kind, start_date, time_to", "'x', 'task', '2026-10-01', '10:00'");
  // La fin après le début.
  await rejectsItem("title, kind, start_date, time_from, time_to", "'x', 'task', '2026-10-01', '10:00', '09:00'");
  await rejectsItem("title, kind, start_date, time_from, time_to", "'x', 'task', '2026-10-01', '10:00', '10:00'");
  // Un créneau bloqué a forcément une heure.
  await rejectsItem("title, kind, start_date", "'x', 'block', '2026-10-01'");
  const ok = await alice(
    "insert into public.items (title, kind, start_date, time_from, time_to) values ('Créneau', 'block', '2026-10-01', '09:00', '10:30') returning id",
  );
  assert.equal(ok.length, 1);
});

test("contraintes : les colonnes JSON sont des objets, les noms de catégories restent petits", async () => {
  await rejectsItem("title, kind, start_date, done", `'x', 'task', '2026-10-01', '[]'`);
  await rejectsItem("title, kind, start_date, skipped", `'x', 'task', '2026-10-01', '"oui"'`);
  await assert.rejects(alice("update public.settings set cat_labels = '[]'"), /violates check constraint/);
  await assert.rejects(
    alice("update public.settings set cat_labels = jsonb_build_object('bleu', $1::text)", ["x".repeat(5000)]),
    /violates check constraint/,
  );
});

test("contraintes : la date de fin est réservée aux séries et ne précède pas leur premier jour", async () => {
  const cols = "title, kind, start_date, recur, until_date";
  await rejectsItem(cols, "'x', 'task', '2026-10-03', 'none', '2026-10-05'");
  await rejectsItem(cols, "'x', 'task', '2026-10-03', 'daily', '2026-10-02'");
  const ok = await alice(
    `insert into public.items (${cols}) values ('Fin de série', 'task', '2026-10-03', 'daily', '2026-10-03') returning id`,
  );
  // Une série ne peut pas redevenir ponctuelle en gardant sa date de fin.
  await assert.rejects(alice("update public.items set recur = 'none' where id = $1", [ok[0].id]), /items_until_ok/);
  await alice("update public.items set recur = 'none', until_date = null where id = $1", [ok[0].id]);
  await alice("delete from public.items where id = $1", [ok[0].id]);
});
