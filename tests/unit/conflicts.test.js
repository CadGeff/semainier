// Chevauchements entre créneaux bloqués.
import test from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Europe/Paris";
const { conflicts, conflictText, CONFLICT_DAYS } = await import("../../public/js/conflicts.js");

const TODAY = "2026-09-30"; // mercredi
let n = 0;
const block = (o) => ({
  id: `b${++n}`,
  title: "Créneau",
  kind: "block",
  recur: "none",
  cat: "bleu",
  done: {},
  skipped: {},
  ...o,
});
const deep = block({
  title: "Deep work",
  start: "2026-09-28",
  from: "09:00",
  to: "11:00",
  recur: "weekly",
  days: [0, 1, 2, 3, 4],
});
const days = (found) => found.map((f) => f.day);

test("un créneau qui en recouvre un autre le même jour est signalé", () => {
  const it = block({ start: "2026-10-01", from: "10:30", to: "11:30" });
  const found = conflicts([deep], it, TODAY);
  assert.deepEqual(days(found), ["2026-10-01"]);
  assert.equal(found[0].others[0].title, "Deep work");
});

test("bout à bout, un autre jour ou un week-end : rien à signaler", () => {
  assert.deepEqual(conflicts([deep], block({ start: "2026-10-01", from: "11:00", to: "12:00" }), TODAY), []);
  assert.deepEqual(conflicts([deep], block({ start: "2026-10-01", from: "08:00", to: "09:00" }), TODAY), []);
  assert.deepEqual(conflicts([deep], block({ start: "2026-10-03", from: "09:00", to: "11:00" }), TODAY), [], "samedi");
});

test("seuls les créneaux bloqués comptent, et jamais l'élément lui-même", () => {
  const task = { ...block({ start: "2026-10-01", from: "09:30", to: "10:00" }), kind: "task" };
  assert.deepEqual(conflicts([deep], task, TODAY), [], "une tâche placée dans un créneau");
  assert.deepEqual(conflicts([task], block({ start: "2026-10-01", from: "09:00", to: "11:00" }), TODAY), []);
  assert.deepEqual(conflicts([deep], { ...deep }, TODAY), [], "modification d'un créneau existant");
  assert.deepEqual(conflicts([deep], block({ start: "2026-10-01" }), TODAY), [], "sans heures");
});

test("une série est examinée jour par jour, dans la limite de sa fin et de cinq semaines", () => {
  const serie = block({ start: "2026-10-01", from: "10:00", to: "12:00", recur: "daily", until: "2026-10-06" });
  // Jeudi 1 et vendredi 2, puis lundi 5 et mardi 6 : le week-end, « Deep work » n'a pas lieu.
  assert.deepEqual(days(conflicts([deep], serie, TODAY)), ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]);
  const sansFin = block({ start: "2026-10-01", from: "10:00", to: "12:00", recur: "daily" });
  const found = conflicts([deep], sansFin, TODAY);
  assert.equal(found.at(-1).day, "2026-11-04", `dernier jour examiné : ${CONFLICT_DAYS} jours après le premier`);
  assert.equal(found.length, 25, "cinq semaines de cinq jours ouvrés");
});

test("un jour retiré de l'autre série, ou une série déjà finie, ne compte pas", () => {
  const troue = { ...deep, id: "x1", skipped: { "2026-10-01": true } };
  assert.deepEqual(conflicts([troue], block({ start: "2026-10-01", from: "09:00", to: "10:00" }), TODAY), []);
  const finie = { ...deep, id: "x2", until: "2026-09-30" };
  assert.deepEqual(conflicts([finie], block({ start: "2026-10-01", from: "09:00", to: "10:00" }), TODAY), []);
});

test("le passé n'est pas examiné : une série ancienne ne signale que ce qui vient", () => {
  const ancienne = block({ start: "2026-09-01", from: "10:00", to: "12:00", recur: "daily", until: "2026-10-01" });
  assert.deepEqual(days(conflicts([deep], ancienne, TODAY)), ["2026-09-30", "2026-10-01"]);
  const passe = block({ start: "2026-09-29", from: "10:00", to: "12:00" });
  assert.deepEqual(conflicts([deep], passe, TODAY), [], "élément ponctuel passé");
});

test("phrase de signalement", () => {
  assert.equal(conflictText([]), "");
  const one = conflicts([deep], block({ start: "2026-10-01", from: "10:30", to: "11:30" }), TODAY);
  assert.equal(conflictText(one), "Chevauche « Deep work » (09:00–11:00) le jeudi 1 octobre.");
  const point = block({ title: "Point d'équipe", start: "2026-10-01", from: "10:45", to: "11:15" });
  const two = conflicts([deep, point], block({ start: "2026-10-01", from: "10:30", to: "11:30" }), TODAY);
  assert.equal(conflictText(two), "Chevauche « Deep work » (09:00–11:00) et 1 autre créneau le jeudi 1 octobre.");
  const serie = block({ start: "2026-10-01", from: "10:00", to: "12:00", recur: "daily", until: "2026-10-05" });
  assert.equal(
    conflictText(conflicts([deep], serie, TODAY)),
    "Chevauche « Deep work » (09:00–11:00) le jeudi 1 octobre, et d'autres créneaux sur 2 autres jours.",
  );
});
