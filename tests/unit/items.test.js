// Validation des imports, noms de catégories, données d'exemple.
import test from "node:test";
import assert from "node:assert/strict";
import { sanitize, cleanLabels, sample, DEFAULT_LABELS, TITLE_MAX } from "../../public/js/items.js";
import { occurs } from "../../public/js/recurrence.js";

test("import : un élément valide est conservé, avec un nouvel identifiant", () => {
  const it = sanitize({
    id: "fourni",
    title: "  Sport  ",
    kind: "block",
    start: "2026-09-29",
    from: "18:30",
    to: "19:30",
    recur: "weekly",
    days: [1, 3],
    cat: "vert",
  });
  assert.equal(it.title, "Sport");
  assert.notEqual(it.id, "fourni");
  assert.match(it.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual([it.from, it.to, it.days, it.cat], ["18:30", "19:30", [1, 3], "vert"]);
});

test("import : rejette ce qui ne peut pas être corrigé", () => {
  for (const raw of [
    null,
    "texte",
    { title: "", kind: "task", start: "2026-09-29" },
    { title: "x", kind: "réunion", start: "2026-09-29" },
    { title: "x", kind: "task", start: "29/09/2026" },
    { title: "Créneau sans heure", kind: "block", start: "2026-09-29" },
    { title: "Fin avant début", kind: "block", start: "2026-09-29", from: "10:00", to: "09:00" },
  ]) {
    assert.equal(sanitize(raw), null, JSON.stringify(raw));
  }
});

test("import : corrige les champs invalides au lieu de les recopier", () => {
  const it = sanitize({
    title: "x".repeat(500),
    kind: "task",
    start: "2026-09-30",
    from: "25:00",
    to: "26:00",
    recur: "yearly",
    cat: "violet",
    done: { "2026-09-30": true, "pas une date": true, "2026-10-01": "oui" },
    extra: "<script>",
  });
  assert.equal(it.title.length, TITLE_MAX);
  assert.equal(it.from, undefined, "heure invalide ignorée : tâche sans heure");
  assert.equal(it.recur, "none");
  assert.equal(it.cat, "bleu");
  assert.deepEqual(it.done, { "2026-09-30": true });
  assert.equal("extra" in it, false);
});

test("import : hebdo sans jour valide → jour de la date de départ", () => {
  const it = sanitize({ title: "x", kind: "task", start: "2026-09-30", recur: "weekly", days: [9, "lundi", 2.5] });
  assert.deepEqual(it.days, [2]); // mercredi
});

test("noms de catégories : longueur bornée, défaut si vide", () => {
  const out = cleanLabels({ bleu: "  Boulot ", vert: "", rose: 42, ambre: "a".repeat(50), inconnue: "x" });
  assert.equal(out.bleu, "Boulot");
  assert.equal(out.vert, DEFAULT_LABELS.vert);
  assert.equal(out.rose, DEFAULT_LABELS.rose);
  assert.equal(out.ambre.length, 30);
  assert.equal("inconnue" in out, false);
  assert.deepEqual(cleanLabels(null), DEFAULT_LABELS);
});

test("données d'exemple : toutes valides et visibles dans la semaine", () => {
  const items = sample(new Date("2026-09-30T10:00:00"));
  assert.equal(items.length, 11);
  for (const it of items) assert.ok(sanitize(it), `${it.title} passe la validation`);
  const week = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
  for (const it of items)
    assert.ok(
      week.some((d) => occurs(it, d)),
      `${it.title} apparaît dans la semaine`,
    );
  const reading = items.find((it) => it.title === "Lire 20 pages");
  assert.deepEqual(Object.keys(reading.done), ["2026-09-28", "2026-09-29"], "jours passés cochés");
});

test("import : rejette les champs du mauvais type et les dates impossibles", () => {
  const ok = { title: "x", kind: "task", start: "2026-09-29", recur: "daily" };
  assert.ok(sanitize(ok));
  for (const start of [["2026-09-29"], 20260929, "2026-02-30", "2026-13-01", "2026-00-10"]) {
    assert.equal(sanitize({ ...ok, start }), null, JSON.stringify(start));
  }
  const noTime = sanitize({ ...ok, from: ["09:00"], to: ["10:00"] });
  assert.equal(noTime.from, undefined);
  assert.equal(sanitize({ ...ok, kind: "block", from: ["09:00"], to: ["10:00"] }), null);
  const flags = sanitize({ ...ok, done: { "2026-09-29": true, "2026-02-31": true, __proto__: true } });
  assert.deepEqual(Object.keys(flags.done), ["2026-09-29"]);
});

test("import : la date de fin n'est gardée que pour une série, et pas avant son premier jour", () => {
  const base = { title: "Lecture", kind: "task", start: "2026-10-03" };
  assert.equal(sanitize({ ...base, recur: "daily", until: "2026-10-05" }).until, "2026-10-05");
  assert.equal(sanitize({ ...base, recur: "daily", until: "2026-10-03" }).until, "2026-10-03", "un seul jour");
  assert.equal("until" in sanitize({ ...base, recur: "none", until: "2026-10-05" }), false, "élément ponctuel");
  assert.equal("until" in sanitize({ ...base, recur: "daily", until: "2026-10-02" }), false, "avant le début");
  assert.equal("until" in sanitize({ ...base, recur: "daily", until: "2026-02-30" }), false, "date impossible");
  assert.equal("until" in sanitize({ ...base, recur: "daily", until: 20261005 }), false, "mauvais type");
  assert.equal("until" in sanitize({ ...base, recur: "daily" }), false);
});
