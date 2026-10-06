// Fuseau fixé avant tout calcul de date : les changements d'heure font partie de ce qui est testé,
// et la CI tourne en UTC, où il n'y en a pas.
process.env.TZ = "Europe/Paris";

import test from "node:test";
import assert from "node:assert/strict";
import { ds } from "../../public/js/recurrence.js";
import {
  monthWeeks,
  addMonths,
  dayEntries,
  upcoming,
  weeksAhead,
  weekLabel,
  blockMinutes,
} from "../../public/js/month.js";

const item = (o) => ({ id: o.title, kind: "task", recur: "none", cat: "bleu", done: {}, skipped: {}, ...o });
const TODAY = "2026-10-03"; // samedi

test("mois : des lundis aux dimanches, de la semaine du 1er à celle du dernier jour", () => {
  const oct = monthWeeks(new Date(2026, 9, 15));
  assert.equal(oct.length, 5);
  assert.equal(ds(oct[0][0]), "2026-09-28");
  assert.equal(ds(oct[4][6]), "2026-11-01");
  assert.ok(oct.every((w) => w.length === 7));
});

test("mois : quatre semaines quand février commence un lundi, six quand le mois déborde", () => {
  assert.equal(monthWeeks(new Date(2027, 1, 10)).length, 4);
  const aug = monthWeeks(new Date(2026, 7, 1));
  assert.equal(aug.length, 6);
  assert.equal(ds(aug[0][0]), "2026-07-27");
  assert.equal(ds(aug[5][6]), "2026-09-06");
});

test("changer de mois : le 31 retombe sur le dernier jour, l'année suit", () => {
  assert.equal(ds(addMonths(new Date(2027, 0, 31), 1)), "2027-02-28");
  assert.equal(ds(addMonths(new Date(2028, 0, 31), 1)), "2028-02-29");
  assert.equal(ds(addMonths(new Date(2026, 11, 15), 1)), "2027-01-15");
  assert.equal(ds(addMonths(new Date(2026, 0, 15), -1)), "2025-12-15");
  assert.equal(ds(addMonths(new Date(2026, 9, 31), -1)), "2026-09-30");
});

test("un jour du mois : les ponctuels d'un côté, les habitudes de l'autre, dans l'ordre des heures", () => {
  const items = [
    item({ title: "Lire", start: "2026-09-01", recur: "daily" }),
    item({ title: "Deep work", kind: "block", start: "2026-09-01", recur: "daily", from: "09:00", to: "11:00" }),
    item({ title: "Sans heure", start: "2026-10-13" }),
    item({ title: "Après-midi", kind: "block", start: "2026-10-13", from: "14:00", to: "15:00" }),
    item({ title: "Matin", kind: "block", start: "2026-10-13", from: "08:00", to: "09:00" }),
    item({ title: "Autre jour", start: "2026-10-14" }),
  ];
  const d = dayEntries(items, "2026-10-13", TODAY);
  assert.deepEqual(
    d.oneOffs.map((i) => i.title),
    ["Matin", "Après-midi", "Sans heure"],
  );
  assert.deepEqual(
    d.routine.map((i) => i.title),
    ["Deep work", "Lire"],
  );
  assert.deepEqual(d.carried, []);
});

test("un jour du mois : les tâches en retard n'apparaissent en report qu'aujourd'hui", () => {
  const items = [item({ title: "En retard", start: "2026-10-01" })];
  assert.deepEqual(
    dayEntries(items, TODAY, TODAY).carried.map((i) => i.title),
    ["En retard"],
  );
  assert.deepEqual(dayEntries(items, "2026-10-02", TODAY).carried, []);
  assert.deepEqual(
    dayEntries(items, "2026-10-01", TODAY).oneOffs.map((i) => i.title),
    ["En retard"],
  );
});

test("à venir : ponctuels seulement, à partir d'aujourd'hui, dans l'ordre", () => {
  const items = [
    item({ title: "Habitude", start: "2026-09-01", recur: "daily" }),
    item({ title: "Hier", kind: "block", start: "2026-10-02", from: "10:00", to: "11:00" }),
    item({ title: "Dans 10 jours", kind: "block", start: "2026-10-13", from: "14:00", to: "15:00" }),
    item({ title: "Aujourd'hui", start: TODAY }),
    item({ title: "Même jour, plus tôt", kind: "block", start: "2026-10-13", from: "09:00", to: "10:00" }),
  ];
  assert.deepEqual(
    upcoming(items, TODAY).map((u) => `${u.day} ${u.item.title}`),
    ["2026-10-03 Aujourd'hui", "2026-10-13 Même jour, plus tôt", "2026-10-13 Dans 10 jours"],
  );
});

test("à venir : la portée est respectée, dernier jour exclu", () => {
  const items = [item({ title: "Jour 34", start: "2026-11-06" }), item({ title: "Jour 35", start: "2026-11-07" })];
  assert.deepEqual(
    upcoming(items, TODAY).map((u) => u.item.title),
    ["Jour 34"],
  );
  assert.deepEqual(upcoming(items, TODAY, 14), []);
});

test("à venir : une tâche faite n'y figure plus, une tâche en retard y figure en report", () => {
  const items = [
    item({ title: "Faite", start: "2026-10-05", done: { "2026-10-05": true } }),
    item({ title: "En retard", start: "2026-10-01" }),
    item({ title: "Trop vieille", start: "2026-09-20" }),
    item({ title: "Rattrapée", start: "2026-10-01", done: { [TODAY]: true } }),
  ];
  assert.deepEqual(upcoming(items, TODAY), [{ day: TODAY, item: items[1], carried: true }]);
});

test("à venir : groupes par semaine, y compris à travers le changement d'heure", () => {
  assert.equal(weeksAhead("2026-10-04", TODAY), 0);
  assert.equal(weeksAhead("2026-10-05", TODAY), 1);
  assert.equal(weeksAhead("2026-10-18", TODAY), 2);
  // Passage à l'heure d'hiver dans la nuit du 24 au 25 octobre 2026.
  assert.equal(weeksAhead("2026-10-26", TODAY), 4);
  assert.equal(weeksAhead("2026-11-02", TODAY), 5);
  // Passage à l'heure d'été le 28 mars 2027 : la semaine suivante est plus courte d'une heure.
  assert.equal(new Date(2027, 2, 29).getTime() - new Date(2027, 2, 22).getTime(), 7 * 864e5 - 36e5);
  assert.equal(weeksAhead("2027-03-29", "2027-03-22"), 1);
  assert.equal(weeksAhead("2027-04-05", "2027-03-27"), 2);
  assert.equal(weekLabel(0), "Cette semaine");
  assert.equal(weekLabel(1), "Semaine prochaine");
  assert.equal(weekLabel(3), "Dans 3 semaines");
});

test("légende : minutes de créneaux par catégorie sur une période, tâches exclues", () => {
  const items = [
    item({ title: "Deep work", kind: "block", start: "2026-09-28", recur: "daily", from: "09:00", to: "11:00" }),
    item({ title: "Dentiste", kind: "block", start: "2026-10-06", from: "14:30", to: "15:15", cat: "vert" }),
    item({ title: "Tâche avec heure", start: "2026-10-06", from: "16:00", to: "17:00", cat: "vert" }),
  ];
  assert.deepEqual(blockMinutes(items, ["2026-10-05", "2026-10-06"]), { bleu: 240, vert: 45 });
  assert.deepEqual(blockMinutes(items, []), {});
});

test("série courte : écrite comme un élément ponctuel ; à partir de huit jours, une habitude", () => {
  const courte = item({ title: "trois jours", start: "2026-10-03", recur: "daily", until: "2026-10-05" });
  const sept = item({ title: "sept jours", start: "2026-10-03", recur: "daily", until: "2026-10-09" });
  const huit = item({ title: "huit jours", start: "2026-10-03", recur: "daily", until: "2026-10-10" });
  const sansFin = item({ title: "sans fin", start: "2026-10-03", recur: "daily" });
  const e = dayEntries([courte, sept, huit, sansFin], "2026-10-04", TODAY);
  assert.deepEqual(
    e.oneOffs.map((it) => it.title),
    ["trois jours", "sept jours"],
  );
  assert.deepEqual(
    e.routine.map((it) => it.title),
    ["huit jours", "sans fin"],
  );
});

test("à venir : chaque jour d'une série courte est listé, sauf ceux déjà faits ; une habitude jamais", () => {
  const courte = item({
    title: "trois jours",
    start: "2026-10-03",
    recur: "daily",
    until: "2026-10-05",
    done: { "2026-10-04": true },
  });
  const huit = item({ title: "huit jours", start: "2026-10-03", recur: "daily", until: "2026-10-10" });
  const creneaux = item({
    title: "stage",
    kind: "block",
    from: "09:00",
    to: "17:00",
    start: "2026-10-05",
    recur: "daily",
    until: "2026-10-06",
  });
  assert.deepEqual(
    upcoming([courte, huit, creneaux], TODAY).map((u) => `${u.day} ${u.item.title}`),
    ["2026-10-03 trois jours", "2026-10-05 stage", "2026-10-05 trois jours", "2026-10-06 stage"],
  );
});

test("à venir : le dernier jour non fait d'une série courte finie y figure, reporté à aujourd'hui", () => {
  const finie = item({ title: "finie hier", start: "2026-09-30", recur: "daily", until: "2026-10-02" });
  assert.deepEqual(upcoming([finie], TODAY), [{ day: TODAY, item: finie, carried: true }]);
  assert.deepEqual(upcoming([{ ...finie, done: { [TODAY]: true } }], TODAY), []);
});
