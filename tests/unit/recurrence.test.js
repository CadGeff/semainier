// Tests des règles de récurrence — aucune dépendance : `node --test`
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../../public/js/recurrence.js";

test("hebdo : uniquement les jours cochés, jamais avant la date de départ", () => {
  const it = { start: "2026-09-29", recur: "weekly", days: [1, 3] }; // mardi et jeudi
  assert.equal(R.occurs(it, "2026-09-28"), false, "lundi");
  assert.equal(R.occurs(it, "2026-09-29"), true, "mardi");
  assert.equal(R.occurs(it, "2026-10-01"), true, "jeudi");
  assert.equal(R.occurs(it, "2026-10-02"), false, "vendredi");
  assert.equal(R.occurs(it, "2026-09-22"), false, "semaine précédente");
});

test("hebdo sans jours : le jour de la date de départ", () => {
  const it = { start: "2026-09-30", recur: "weekly" }; // mercredi
  assert.equal(R.occurs(it, "2026-10-07"), true);
  assert.equal(R.occurs(it, "2026-10-08"), false);
});

test("mensuel : le 31 retombe sur le dernier jour des mois courts", () => {
  const it = { start: "2026-01-31", recur: "monthly" };
  assert.equal(R.occurs(it, "2026-02-28"), true, "février");
  assert.equal(R.occurs(it, "2026-03-31"), true, "mars");
  assert.equal(R.occurs(it, "2026-04-30"), true, "avril");
  assert.equal(R.occurs(it, "2026-04-29"), false);
  assert.equal(R.occurs({ start: "2028-01-31", recur: "monthly" }, "2028-02-29"), true, "année bissextile");
});

test("quotidien : tous les jours sauf ceux retirés de la série", () => {
  const it = { start: "2026-09-28", recur: "daily", skipped: { "2026-09-30": true } };
  assert.equal(R.occurs(it, "2026-10-05"), true);
  assert.equal(R.occurs(it, "2026-09-30"), false);
  assert.equal(R.occurs(it, "2026-09-27"), false, "avant le départ");
});

test("ponctuel : seulement à sa date", () => {
  const it = { start: "2026-09-28", recur: "none" };
  assert.equal(R.occurs(it, "2026-09-28"), true);
  assert.equal(R.occurs(it, "2026-09-29"), false);
});

test("cocher une occurrence ne coche pas les suivantes", () => {
  const it = { start: "2026-09-28", recur: "daily", done: { "2026-09-28": true } };
  assert.equal(R.isDone(it, "2026-09-28"), true);
  assert.equal(R.isDone(it, "2026-09-29"), false);
});

test("semaines ISO 8601", () => {
  assert.equal(R.isoWeek(new Date(2026, 8, 28)), 40);
  assert.equal(R.isoWeek(new Date(2026, 11, 31)), 53, "2026 compte 53 semaines");
  assert.equal(R.isoWeek(new Date(2027, 0, 4)), 1);
});

test("libellés de récurrence", () => {
  assert.equal(
    R.recurText({ start: "2026-09-28", recur: "weekly", days: [4, 0, 1, 2, 3] }),
    "Chaque jour de semaine (lun → ven)",
  );
  assert.equal(R.recurText({ start: "2026-09-28", recur: "weekly", days: [1, 3] }), "Chaque semaine : mardi, jeudi");
  assert.equal(R.recurText({ start: "2026-10-05", recur: "monthly" }), "Chaque mois, le 5");
});

test("fin de série : la série s'arrête après son dernier jour, qui est compris", () => {
  const it = { start: "2026-10-03", recur: "daily", until: "2026-10-05" };
  assert.equal(R.occurs(it, "2026-10-02"), false, "avant le début");
  assert.equal(R.occurs(it, "2026-10-03"), true);
  assert.equal(R.occurs(it, "2026-10-05"), true, "dernier jour");
  assert.equal(R.occurs(it, "2026-10-06"), false, "lendemain de la fin");
  const weekly = { start: "2026-09-29", recur: "weekly", days: [1], until: "2026-10-13" };
  assert.equal(R.occurs(weekly, "2026-10-13"), true);
  assert.equal(R.occurs(weekly, "2026-10-20"), false);
  const monthly = { start: "2026-01-31", recur: "monthly", until: "2026-03-30" };
  assert.equal(R.occurs(monthly, "2026-02-28"), true);
  assert.equal(R.occurs(monthly, "2026-03-31"), false, "le 31 mars est après la fin");
});

test("fin de série : sans effet sur un élément ponctuel, et un jour retiré le reste", () => {
  assert.equal(R.occurs({ start: "2026-10-03", recur: "none", until: "2026-10-01" }, "2026-10-03"), true);
  assert.equal(R.untilOf({ start: "2026-10-03", recur: "none", until: "2026-10-05" }), null);
  assert.equal(R.untilOf({ start: "2026-10-03", recur: "daily" }), null);
  const it = { start: "2026-10-03", recur: "daily", until: "2026-10-05", skipped: { "2026-10-04": true } };
  assert.equal(R.occurs(it, "2026-10-04"), false);
  assert.equal(R.occurs(it, "2026-10-05"), true);
});

test("libellé d'une série qui a une fin", () => {
  assert.equal(
    R.recurText({ start: "2026-10-03", recur: "daily", until: "2026-10-05" }),
    "Chaque jour, jusqu'au 5 octobre",
  );
  assert.equal(
    R.recurText({ start: "2026-09-29", recur: "weekly", days: [1, 3], until: "2026-11-01" }),
    "Chaque semaine : mardi, jeudi, jusqu'au 1er novembre",
  );
  assert.equal(
    R.recurText({ start: "2026-12-15", recur: "monthly", until: "2027-03-15" }),
    "Chaque mois, le 15, jusqu'au 15 mars 2027",
    "l'année est précisée quand elle change",
  );
  assert.equal(R.recurText({ start: "2026-10-03", recur: "none", until: "2026-10-05" }), "Une seule fois");
});
