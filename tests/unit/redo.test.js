// « Refaire » : jour proposé et copie d'un élément.
import test from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Europe/Paris";
const { redoDay, redoLabel, redoWhen, redoCopy } = await import("../../public/js/redo.js");

const TODAY = "2026-09-30"; // mercredi

test("jour proposé : demain pour un élément d'aujourd'hui ou passé", () => {
  assert.equal(redoDay(TODAY, TODAY), "2026-10-01");
  assert.equal(redoDay("2026-09-28", TODAY), "2026-10-01", "élément de lundi : demain, pas mardi");
  assert.equal(redoDay("2020-01-01", TODAY), "2026-10-01");
});

test("jour proposé : le lendemain de l'élément quand il est à venir", () => {
  assert.equal(redoDay("2026-10-03", TODAY), "2026-10-04");
  assert.equal(redoDay("2026-10-31", TODAY), "2026-11-01", "changement de mois");
  assert.equal(redoDay("2026-12-31", TODAY), "2027-01-01", "changement d'année");
  // Passage à l'heure d'hiver dans la nuit du 24 au 25 octobre 2026 : le jour suivant reste le bon.
  assert.equal(redoDay("2026-10-24", TODAY), "2026-10-25");
  assert.equal(redoDay("2026-10-25", TODAY), "2026-10-26");
});

test("libellé du bouton et de la confirmation", () => {
  assert.equal(redoLabel("2026-10-01", TODAY), "Demain");
  assert.equal(redoWhen("2026-10-01", TODAY), "demain");
  assert.equal(redoLabel("2026-10-04", TODAY), "Dim. 4 oct.");
  assert.equal(redoWhen("2026-10-04", TODAY), "le dimanche 4 octobre");
});

test("copie : même contenu, à faire une seule fois, sans rien hériter de l'original", () => {
  const original = {
    id: "a",
    title: "Sport",
    kind: "block",
    start: "2026-09-29",
    from: "18:30",
    to: "19:30",
    recur: "weekly",
    days: [1, 3],
    until: "2026-12-31",
    cat: "vert",
    done: { "2026-09-29": true },
    skipped: { "2026-10-01": true },
  };
  const copy = redoCopy(original, "2026-10-02");
  assert.notEqual(copy.id, "a");
  assert.match(copy.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...copy, id: "" },
    {
      id: "",
      title: "Sport",
      kind: "block",
      start: "2026-10-02",
      recur: "none",
      cat: "vert",
      done: {},
      skipped: {},
      from: "18:30",
      to: "19:30",
    },
  );
  // L'original n'est pas touché.
  assert.deepEqual(original.done, { "2026-09-29": true });
});

test("copie d'une tâche sans heure : pas d'heure inventée", () => {
  const copy = redoCopy(
    { id: "t", title: "Courses", kind: "task", start: "2026-10-03", recur: "none", cat: "gris", done: {}, skipped: {} },
    "2026-10-04",
  );
  assert.equal("from" in copy, false);
  assert.equal("to" in copy, false);
  assert.equal(copy.kind, "task");
});
