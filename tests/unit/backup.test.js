// Sauvegarde : contenu de l'export, lecture d'un import, doublons, rappel.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT,
  REMIND_AFTER_DAYS,
  backupReminder,
  buildExport,
  isDefaultLabels,
  readExport,
  signature,
  withoutDuplicates,
} from "../../public/js/backup.js";
import { DEFAULT_LABELS, sample } from "../../public/js/items.js";

const NOW = new Date("2026-09-30T10:00:00");
const LABELS = { ...DEFAULT_LABELS, bleu: "Boulot" };

test("export : contient les éléments et les noms des catégories", () => {
  const items = sample(NOW);
  const data = buildExport(items, LABELS, NOW);
  assert.equal(data.app, "semainier");
  assert.equal(data.format, FORMAT);
  assert.equal(data.exportedAt, NOW.toISOString());
  assert.equal(data.labels.bleu, "Boulot");
  assert.deepEqual(data.items, items);
  assert.notEqual(data.items[0], items[0], "l'export ne partage pas les objets du planning");
});

test("import : relit un export complet, coches comprises", () => {
  const items = sample(NOW);
  const read = readExport(JSON.stringify(buildExport(items, LABELS, NOW)));
  assert.equal(read.ok, true);
  if (read.ok === false) return;
  assert.equal(read.items.length, items.length);
  assert.equal(read.invalid, 0);
  assert.equal(read.labels.bleu, "Boulot");
  assert.deepEqual(
    read.items.map((it) => it.done),
    items.map((it) => it.done),
  );
  assert.deepEqual(read.items.map(signature), items.map(signature));
});

test("import : accepte l'ancien format sans noms de catégories", () => {
  const item = { title: "Courses", kind: "task", start: "2026-09-30", recur: "none", cat: "gris" };
  for (const text of [JSON.stringify([item]), JSON.stringify({ app: "semainier", format: 1, items: [item] })]) {
    const read = readExport(text);
    assert.equal(read.ok, true);
    if (read.ok === false) return;
    assert.equal(read.items.length, 1);
    assert.equal(read.labels, null);
  }
});

test("import : refuse ce qui n'est pas une sauvegarde", () => {
  assert.deepEqual(readExport("pas du json"), { ok: false, error: "Ce fichier n'est pas un JSON valide." });
  for (const text of ["null", "42", '{"items":"non"}', '{"autre":[]}']) {
    assert.equal(readExport(text).ok, false, text);
  }
});

test("import : les noms de catégories sont revalidés", () => {
  const read = readExport(
    JSON.stringify({ items: [], labels: { bleu: "x".repeat(80), vert: 12, inconnu: "<script>", rose: "  RDV  " } }),
  );
  assert.equal(read.ok, true);
  if (read.ok === false) return;
  assert.equal(read.labels.bleu.length, 30);
  assert.equal(read.labels.vert, DEFAULT_LABELS.vert);
  assert.equal(read.labels.rose, "RDV");
  assert.equal("inconnu" in read.labels, false);
  const list = readExport('{"items":[],"labels":["a"]}');
  assert.equal(list.ok && list.labels, null);
});

test("doublons : réimporter sa sauvegarde n'ajoute rien", () => {
  const items = sample(NOW);
  const read = readExport(JSON.stringify(buildExport(items, LABELS, NOW)));
  if (read.ok === false) return assert.fail();
  assert.deepEqual(withoutDuplicates(read.items, items), { fresh: [], duplicates: items.length });
});

test("doublons : seuls les éléments manquants sont repris", () => {
  const items = sample(NOW);
  const read = readExport(JSON.stringify(buildExport(items, LABELS, NOW)));
  if (read.ok === false) return assert.fail();
  const kept = items.slice(0, 4);
  const { fresh, duplicates } = withoutDuplicates(read.items, kept);
  assert.equal(duplicates, 4);
  assert.deepEqual(fresh.map(signature), items.slice(4).map(signature));
});

test("doublons : deux éléments identiques dans la sauvegarde restent deux", () => {
  const twin = { id: "a", title: "Courses", kind: "task", start: "2026-09-30", recur: "none", cat: "gris" };
  const incoming = /** @type {any[]} */ ([twin, { ...twin, id: "b" }]);
  assert.equal(withoutDuplicates(incoming, []).fresh.length, 2);
  assert.equal(withoutDuplicates(incoming, [/** @type {any} */ ({ ...twin, id: "c" })]).fresh.length, 1);
});

test("empreinte : ignore l'identifiant, les coches et l'ordre des jours", () => {
  const a = {
    id: "1",
    title: "Sport",
    kind: "block",
    start: "2026-09-29",
    from: "18:30",
    to: "19:30",
    recur: "weekly",
  };
  const one = /** @type {any} */ ({ ...a, days: [1, 3], cat: "vert", done: { "2026-09-29": true }, skipped: {} });
  const two = /** @type {any} */ ({ ...a, id: "2", days: [3, 1], cat: "vert", done: {}, skipped: {} });
  assert.equal(signature(one), signature(two));
  assert.notEqual(signature(one), signature({ ...two, to: "20:00" }));
  assert.notEqual(signature(one), signature({ ...two, cat: "bleu" }));
});

test("noms par défaut reconnus", () => {
  assert.equal(isDefaultLabels({ ...DEFAULT_LABELS }), true);
  assert.equal(isDefaultLabels(LABELS), false);
});

test("rappel : jamais, récent, en retard", () => {
  assert.deepEqual(backupReminder(null, NOW), {
    text: "Aucune sauvegarde faite depuis cet appareil.",
    late: false,
    never: true,
  });
  assert.equal(backupReminder("n'importe quoi", NOW).never, true);
  assert.equal(backupReminder("2026-09-30T08:00:00", NOW).text, "Dernière sauvegarde : aujourd'hui.");
  assert.equal(backupReminder("2026-09-29T23:50:00", NOW).text, "Dernière sauvegarde : hier.");
  const limit = new Date(NOW.getTime() - REMIND_AFTER_DAYS * 86400000).toISOString();
  assert.deepEqual(backupReminder(limit, NOW), {
    text: "Dernière sauvegarde : il y a 30 jours.",
    late: false,
    never: false,
  });
  const late = backupReminder("2026-08-01T10:00:00", NOW);
  assert.equal(late.late, true);
  assert.equal(late.text, "Dernière sauvegarde : il y a 60 jours. Pense à en refaire une.");
  assert.equal(backupReminder("2027-01-01T00:00:00", NOW).text, "Dernière sauvegarde : aujourd'hui.");
});

test("fin de série : conservée par l'export et l'import, et distinguée par le dédoublonnage", () => {
  const sansFin = {
    id: "a",
    title: "Lecture",
    kind: "task",
    start: "2026-10-03",
    recur: "daily",
    cat: "gris",
    done: {},
    skipped: {},
  };
  const bornee = { ...sansFin, id: "b", until: "2026-10-05" };
  const data = buildExport([bornee], LABELS, NOW);
  assert.equal(data.items[0].until, "2026-10-05");
  const read = readExport(JSON.stringify(data));
  if (read.ok === false) return assert.fail(read.error);
  assert.equal(read.items[0].until, "2026-10-05");

  assert.notEqual(signature(sansFin), signature(bornee));
  assert.notEqual(signature(bornee), signature({ ...bornee, until: "2026-10-06" }));
  // La même série, bornée dans la sauvegarde et sans fin dans le planning : ce n'est pas un doublon.
  assert.deepEqual(withoutDuplicates([bornee], [sansFin]), { fresh: [bornee], duplicates: 0 });
  assert.deepEqual(withoutDuplicates([bornee], [{ ...bornee, id: "c" }]), { fresh: [], duplicates: 1 });
  // Une date de fin restée sur un élément ponctuel n'a pas de sens : elle ne le distingue pas.
  const ponctuel = { ...sansFin, recur: "none" };
  assert.equal(signature(ponctuel), signature({ ...ponctuel, until: "2026-10-05" }));
});

test("coche tardive d'une série courte : elle survit à l'export puis à l'import", () => {
  // Du 27 au 29 septembre, dernier jour fait le 30 : la coche est postérieure à la fin de la série.
  const fait = {
    id: "a",
    title: "Trois soirs",
    kind: "task",
    start: "2026-09-27",
    until: "2026-09-29",
    recur: "daily",
    cat: "gris",
    done: { "2026-09-27": true, "2026-09-30": true },
    skipped: {},
  };
  const read = readExport(JSON.stringify(buildExport([fait], LABELS, NOW)));
  if (read.ok === false) return assert.fail(read.error);
  assert.deepEqual(read.items[0].done, fait.done);
});
