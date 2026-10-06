// Report des tâches ponctuelles non faites.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CARRY_DAYS,
  carriedFor,
  carryDay,
  doneAfterEdit,
  doneAfterSkip,
  doneAfterToggle,
  doneDay,
  isCarriedFrom,
  isCarrying,
  isOneOff,
  taskDone,
} from "../../public/js/carry.js";

const TODAY = "2026-09-30"; // mercredi
/** @returns {any} */
const task = (o) => ({ id: o.title, kind: "task", recur: "none", cat: "bleu", done: {}, skipped: {}, ...o });

test("seules les tâches « une seule fois » se reportent", () => {
  assert.equal(isOneOff(task({ title: "a", start: TODAY })), true);
  assert.equal(isOneOff(task({ title: "b", start: TODAY, recur: "daily" })), false);
  assert.equal(isOneOff(task({ title: "c", start: TODAY, kind: "block", from: "09:00", to: "10:00" })), false);
  for (const recur of ["daily", "weekly", "monthly"]) {
    assert.equal(isCarrying(task({ title: "r", start: "2026-09-28", recur }), TODAY), false, recur);
  }
  assert.equal(isCarrying(task({ title: "bloc", start: "2026-09-28", kind: "block" }), TODAY), false);
});

test("une tâche non cochée la veille est reportée, avec ou sans heure", () => {
  const sans = task({ title: "sans heure", start: "2026-09-29" });
  const avec = task({ title: "avec heure", start: "2026-09-29", from: "16:00", to: "16:30" });
  assert.equal(isCarrying(sans, TODAY), true);
  assert.equal(isCarrying(avec, TODAY), true);
  assert.deepEqual(
    carriedFor([sans, avec], TODAY, TODAY).map((it) => it.title),
    ["sans heure", "avec heure"],
  );
});

test("pas de report pour aujourd'hui, le futur, ni une tâche déjà cochée", () => {
  assert.equal(isCarrying(task({ title: "a", start: TODAY }), TODAY), false);
  assert.equal(isCarrying(task({ title: "b", start: "2026-10-01" }), TODAY), false);
  assert.equal(isCarrying(task({ title: "c", start: "2026-09-29", done: { "2026-09-29": true } }), TODAY), false);
  assert.equal(isCarrying(task({ title: "d", start: "2026-09-29", skipped: { "2026-09-29": true } }), TODAY), false);
});

test(`le report s'arrête après ${CARRY_DAYS} jours`, () => {
  assert.equal(isCarrying(task({ title: "limite", start: "2026-09-23" }), TODAY), true);
  assert.equal(isCarrying(task({ title: "trop vieille", start: "2026-09-22" }), TODAY), false);
  assert.deepEqual(carriedFor([task({ title: "trop vieille", start: "2026-09-22" })], TODAY, TODAY), []);
});

test("le report n'apparaît qu'aujourd'hui, pas les jours intermédiaires ni demain", () => {
  const items = [task({ title: "lundi", start: "2026-09-28" })];
  assert.equal(carriedFor(items, TODAY, TODAY).length, 1);
  assert.equal(carriedFor(items, "2026-09-29", TODAY).length, 0);
  assert.equal(carriedFor(items, "2026-10-01", TODAY).length, 0);
  assert.equal(carriedFor(items, "2026-09-28", TODAY).length, 0, "à sa date prévue, c'est une tâche normale");
});

test("les plus anciennes d'abord", () => {
  const items = [task({ title: "mardi", start: "2026-09-29" }), task({ title: "lundi", start: "2026-09-28" })];
  assert.deepEqual(
    carriedFor(items, TODAY, TODAY).map((it) => it.title),
    ["lundi", "mardi"],
  );
});

test("cochée après report : faite partout, affichée le jour où elle a été faite", () => {
  const it = task({ title: "lundi", start: "2026-09-28", done: { [TODAY]: true } });
  assert.equal(doneDay(it), TODAY);
  assert.equal(taskDone(it, "2026-09-28"), true, "cochée à sa date prévue");
  assert.equal(taskDone(it, TODAY), true);
  assert.equal(isCarrying(it, "2026-10-01"), false, "le report s'arrête");
  assert.equal(carriedFor([it], TODAY, "2026-10-02").length, 1, "reste visible le jour où elle a été faite");
  assert.equal(carriedFor([it], "2026-10-02", "2026-10-02").length, 0);
});

test("une tâche récurrente reste cochée jour par jour", () => {
  const it = task({ title: "lecture", start: "2026-09-01", recur: "daily", done: { "2026-09-29": true } });
  assert.equal(taskDone(it, "2026-09-29"), true);
  assert.equal(taskDone(it, TODAY), false);
  assert.equal(doneDay(task({ title: "vide", start: TODAY })), null);
});

test("une coche mal formée ne compte pas", () => {
  const it = task({ title: "x", start: "2026-09-29", done: { nimporte: true, "2026-09-29": false } });
  assert.equal(doneDay(it), null);
  assert.equal(isCarrying(it, TODAY), true);
});

test("changement de mois et d'année", () => {
  assert.equal(isCarrying(task({ title: "a", start: "2026-09-28" }), "2026-10-02"), true);
  assert.equal(isCarrying(task({ title: "b", start: "2025-12-29" }), "2026-01-03"), true);
  assert.equal(isCarrying(task({ title: "c", start: "2025-12-26" }), "2026-01-03"), false);
});

test("une coche antérieure à la date prévue est ignorée", () => {
  const it = task({ title: "x", start: "2026-10-02", done: { "2026-09-28": true, "2026-09-29": true } });
  assert.equal(doneDay(it), null);
  assert.equal(taskDone(it, "2026-10-02"), false);
});

test("modification : déplacer une tâche ponctuelle faite la remet à faire", () => {
  const before = task({ title: "x", start: "2026-09-28", done: { "2026-09-30": true } });
  assert.deepEqual(doneAfterEdit(before, { ...before, start: "2026-10-02" }), {});
  assert.deepEqual(doneAfterEdit(before, { ...before, title: "renommée" }), { "2026-09-30": true });
});

test("modification : une série devenue ponctuelle n'hérite pas des coches de la série", () => {
  const serie = task({
    title: "lecture",
    start: "2026-09-01",
    recur: "daily",
    done: { "2026-09-28": true, "2026-09-29": true },
  });
  assert.deepEqual(doneAfterEdit(serie, { ...serie, recur: "none", start: "2026-10-02" }), {});
  assert.deepEqual(doneAfterEdit(serie, { ...serie, recur: "none", start: "2026-09-29" }), { "2026-09-29": true });
  assert.deepEqual(doneAfterEdit(serie, { ...serie, recur: "none" }), {});
});

test("modification : une ponctuelle faite après report, devenue série, reste cochée à sa date", () => {
  const before = task({ title: "x", start: "2026-09-28", done: { "2026-09-30": true } });
  assert.deepEqual(doneAfterEdit(before, { ...before, recur: "weekly", days: [0] }), { "2026-09-28": true });
  assert.deepEqual(
    doneAfterEdit(task({ title: "y", start: "2026-09-28" }), { ...before, recur: "weekly", done: {} }),
    {},
  );
});

test("modification : une série garde ses coches, un créneau n'en a pas", () => {
  const serie = task({ title: "lecture", start: "2026-09-01", recur: "daily", done: { "2026-09-28": true } });
  assert.deepEqual(doneAfterEdit(serie, { ...serie, title: "lire", start: "2026-09-02" }), { "2026-09-28": true });
  const bloc = task({ title: "rdv", start: "2026-09-28", kind: "block", from: "09:00", to: "10:00" });
  assert.deepEqual(doneAfterEdit(bloc, { ...bloc, kind: "task" }), {});
});

// ------------------------------------------------------------------ Séries courtes
// Une série qui a une fin et tient en sept jours au plus : son dernier jour se reporte.
const serie = (o) => task({ recur: "daily", ...o });
/** Du dimanche 27 au mardi 29 septembre : finie hier. */
const TROIS = { title: "trois jours", start: "2026-09-27", until: "2026-09-29" };

test("série courte : le jour qui se reporte est son dernier jour", () => {
  assert.equal(carryDay(task({ title: "p", start: "2026-09-29" })), "2026-09-29", "tâche ponctuelle : sa date");
  assert.equal(carryDay(serie(TROIS)), "2026-09-29");
  assert.equal(carryDay(serie({ ...TROIS, skipped: { "2026-09-29": true } })), "2026-09-28", "dernier jour retiré");
  // Mardi et jeudi, du mardi 22 au dimanche 27 : le dernier jour est le jeudi.
  assert.equal(
    carryDay(serie({ title: "h", start: "2026-09-22", until: "2026-09-27", recur: "weekly", days: [1, 3] })),
    "2026-09-24",
  );
  assert.equal(carryDay(serie({ title: "sans fin", start: "2026-09-27" })), null);
  assert.equal(carryDay(serie({ ...TROIS, kind: "block", from: "09:00", to: "10:00" })), null, "un créneau");
});

test("série courte : sept jours au plus ; à partir de huit, c'est une habitude qui ne se reporte pas", () => {
  const sept = serie({ title: "sept", start: "2026-09-23", until: "2026-09-29" });
  const huit = serie({ title: "huit", start: "2026-09-22", until: "2026-09-29" });
  assert.equal(carryDay(sept), "2026-09-29");
  assert.equal(isCarrying(sept, TODAY), true);
  assert.equal(carryDay(huit), null);
  assert.equal(isCarrying(huit, TODAY), false);
  assert.deepEqual(
    carriedFor([sept, huit], TODAY, TODAY).map((it) => it.title),
    ["sept"],
  );
});

test("série courte : seul le dernier jour se reporte, et seulement une fois la série finie", () => {
  const it = serie(TROIS);
  assert.equal(isCarrying(it, TODAY), true);
  assert.equal(isCarriedFrom(it, "2026-09-29", TODAY), true);
  assert.equal(isCarriedFrom(it, "2026-09-28", TODAY), false, "la marque du report ne va que sur le dernier jour");
  assert.deepEqual(
    carriedFor([it], TODAY, TODAY).map((x) => x.title),
    ["trois jours"],
  );
  assert.equal(carriedFor([it], "2026-09-29", TODAY).length, 0, "pas sur son propre jour");
  // La même série, pas encore finie : rater ses premiers jours ne reporte rien.
  const enCours = serie({ title: "en cours", start: "2026-09-28", until: "2026-09-30" });
  assert.equal(isCarrying(enCours, TODAY), false);
  assert.deepEqual(carriedFor([enCours], TODAY, TODAY), []);
});

test("série courte : dernier jour fait à temps, pas de report ; les autres jours restent indépendants", () => {
  const it = serie({ ...TROIS, done: { "2026-09-29": true } });
  assert.equal(isCarrying(it, TODAY), false);
  assert.equal(taskDone(it, "2026-09-29"), true);
  assert.equal(taskDone(it, "2026-09-28"), false);
  assert.equal(taskDone(serie({ ...TROIS, done: { "2026-09-27": true } }), "2026-09-27"), true);
  assert.equal(
    isCarrying(serie({ ...TROIS, done: { "2026-09-27": true } }), TODAY),
    true,
    "une coche d'un autre jour ne compte pas",
  );
});

test("série courte : cocher après report marque aussi le dernier jour, décocher l'efface où qu'on clique", () => {
  const it = serie({ ...TROIS, done: { "2026-09-27": true } });
  const fait = { ...it, done: doneAfterToggle(it, TODAY) };
  assert.deepEqual(fait.done, { "2026-09-27": true, [TODAY]: true });
  assert.equal(doneDay(fait), TODAY);
  assert.equal(taskDone(fait, "2026-09-29"), true, "faite à son jour prévu");
  assert.equal(taskDone(fait, TODAY), true);
  assert.equal(taskDone(fait, "2026-09-28"), false, "le jour d'avant garde son propre état");
  assert.equal(isCarrying(fait, TODAY), false);
  assert.deepEqual(
    carriedFor([fait], TODAY, TODAY).map((x) => x.title),
    ["trois jours"],
    "trace le jour où elle a été faite",
  );
  assert.equal(carriedFor([fait], "2026-10-01", "2026-10-01").length, 0);
  // On la décoche depuis son jour prévu : la coche tardive part, celle du premier jour reste.
  assert.deepEqual(doneAfterToggle(fait, "2026-09-29"), { "2026-09-27": true });
  // Les autres jours se cochent et se décochent pour eux seuls.
  assert.deepEqual(doneAfterToggle(fait, "2026-09-28"), { "2026-09-27": true, "2026-09-28": true, [TODAY]: true });
  assert.deepEqual(doneAfterToggle(fait, "2026-09-27"), { [TODAY]: true });
});

test("cocher : tâche ponctuelle et habitude gardent leurs règles", () => {
  const ponctuelle = task({ title: "p", start: "2026-09-28" });
  assert.deepEqual(doneAfterToggle(ponctuelle, TODAY), { [TODAY]: true });
  assert.deepEqual(doneAfterToggle({ ...ponctuelle, done: { [TODAY]: true } }, "2026-09-28"), {});
  const habitude = serie({ title: "h", start: "2026-09-01", done: { "2026-09-29": true } });
  assert.deepEqual(doneAfterToggle(habitude, TODAY), { "2026-09-29": true, [TODAY]: true });
  assert.deepEqual(doneAfterToggle(habitude, "2026-09-29"), {});
});

test(`série courte : le report s'arrête après ${CARRY_DAYS} jours, comme pour une tâche ponctuelle`, () => {
  assert.equal(isCarrying(serie({ title: "limite", start: "2026-09-21", until: "2026-09-23" }), TODAY), true);
  assert.equal(isCarrying(serie({ title: "trop vieille", start: "2026-09-20", until: "2026-09-22" }), TODAY), false);
});

test("modification d'une série courte faite après report : la coche revient sur le jour prévu si la règle change", () => {
  const fait = serie({ ...TROIS, done: { "2026-09-27": true, [TODAY]: true } });
  assert.deepEqual(doneAfterEdit(fait, { ...fait, title: "renommée" }), fait.done, "intitulé seul : rien ne bouge");
  // Prolongée jusqu'au 5 octobre : le 30 septembre devient un jour ordinaire de la série.
  assert.deepEqual(doneAfterEdit(fait, { ...fait, until: "2026-10-05" }), { "2026-09-27": true, "2026-09-29": true });
  const aTemps = serie({ ...TROIS, done: { "2026-09-29": true } });
  assert.deepEqual(doneAfterEdit(aTemps, { ...aTemps, until: "2026-10-05" }), { "2026-09-29": true });
});

test("série courte : dernier jour coché puis retiré, le jour d'avant prend le relais sans en hériter", () => {
  // Du 27 au 29, le 29 coché puis retiré : le dernier jour devient le 28, qui n'a pas été fait.
  const coche = serie({ ...TROIS, done: { "2026-09-29": true } });
  const it = { ...coche, done: doneAfterSkip(coche, "2026-09-29"), skipped: { "2026-09-29": true } };
  assert.deepEqual(it.done, {});
  assert.equal(carryDay(it), "2026-09-28");
  assert.equal(doneDay(it), null);
  assert.equal(isCarrying(it, TODAY), true);
  assert.deepEqual(carriedFor([it], "2026-09-29", TODAY), [], "pas de trace fantôme le jour retiré");
});

test("série courte dont le dernier jour précède la fin : elle se reporte et se coche dès le lendemain", () => {
  // Lundi, mercredi et vendredi, du lundi 28 septembre au dimanche 4 octobre. Samedi 3 : le vendredi n'est pas fait.
  const SAMEDI = "2026-10-03";
  const it = serie({ title: "lmv", start: "2026-09-28", until: "2026-10-04", recur: "weekly", days: [0, 2, 4] });
  assert.equal(carryDay(it), "2026-10-02");
  assert.equal(isCarrying(it, SAMEDI), true, "sans attendre la date de fin");
  const fait = { ...it, done: doneAfterToggle(it, SAMEDI) };
  assert.deepEqual(fait.done, { [SAMEDI]: true });
  assert.equal(taskDone(fait, SAMEDI), true, "la coche prend, bien qu'elle tombe avant la date de fin");
  assert.equal(taskDone(fait, "2026-10-02"), true);
  assert.equal(doneDay(fait), SAMEDI);
  assert.equal(isCarrying(fait, SAMEDI), false);
  assert.deepEqual(doneAfterToggle(fait, SAMEDI), {}, "et se décoche");
  // Les sept jours de report se comptent depuis le dernier jour, pas depuis la date de fin.
  assert.equal(isCarrying(it, "2026-10-09"), true, "vendredi suivant");
  assert.equal(isCarrying(it, "2026-10-10"), false, "huit jours après le dernier jour");
  // Même chose quand le dernier jour a été retiré, ou pour une mensuelle finie quelques jours après.
  const retire = serie({ title: "lv", start: "2026-09-28", until: "2026-10-02", skipped: { "2026-10-02": true } });
  assert.equal(taskDone({ ...retire, done: doneAfterToggle(retire, "2026-10-02") }, "2026-10-02"), true);
  const mensuelle = serie({ title: "m", start: "2026-10-05", until: "2026-10-10", recur: "monthly" });
  assert.equal(taskDone({ ...mensuelle, done: doneAfterToggle(mensuelle, "2026-10-07") }, "2026-10-07"), true);
});

test("tâches reportées : triées par leur jour prévu, pas par le début de leur série", () => {
  const ponctuelle = task({ title: "ponctuelle du 28", start: "2026-09-28" });
  // Commencée le 25, mais c'est son dernier jour, le 29, qui se reporte : elle vient après.
  const courte = serie({ title: "série finie le 29", start: "2026-09-25", until: "2026-09-29" });
  assert.deepEqual(
    carriedFor([courte, ponctuelle], TODAY, TODAY).map((it) => it.title),
    ["ponctuelle du 28", "série finie le 29"],
  );
});

test("série modifiée : une coche ne survit que si son jour fait encore partie de la série", () => {
  // Lundi, mercredi, vendredi, tous faits ; le vendredi est décoché de la règle.
  const lmv = serie({
    title: "lmv",
    start: "2026-09-21",
    until: "2026-09-27",
    recur: "weekly",
    days: [0, 2, 4],
    done: { "2026-09-21": true, "2026-09-23": true, "2026-09-25": true },
  });
  const lm = { ...lmv, days: [0, 2] };
  lm.done = doneAfterEdit(lmv, lm);
  assert.deepEqual(lm.done, { "2026-09-21": true, "2026-09-23": true });
  assert.equal(doneDay(lm), "2026-09-23", "mercredi fait à temps, et non « le vendredi, après report »");
  // Date de départ avancée d'un jour, rythme changé : mêmes règles.
  assert.deepEqual(doneAfterEdit(lmv, { ...lmv, start: "2026-09-22" }), { "2026-09-23": true, "2026-09-25": true });
  assert.deepEqual(doneAfterEdit(lmv, { ...lmv, recur: "daily", days: undefined }), lmv.done);
  // Coche tardive : ramenée au jour prévu, puis gardée seulement s'il existe encore.
  const tard = { ...lmv, done: { "2026-09-21": true, "2026-09-26": true } };
  assert.deepEqual(doneAfterEdit(tard, { ...tard, until: "2026-10-04" }), { "2026-09-21": true, "2026-09-25": true });
  assert.deepEqual(doneAfterEdit(tard, { ...tard, days: [0, 2] }), { "2026-09-21": true });
  // Une habitude garde tout son historique, même les jours que sa nouvelle règle n'a plus.
  const habitude = serie({
    title: "h",
    start: "2026-08-03",
    recur: "weekly",
    days: [0, 2],
    done: { "2026-08-03": true },
  });
  assert.deepEqual(doneAfterEdit(habitude, { ...habitude, days: [1, 3] }), { "2026-08-03": true });
  // Devenue un créneau : il n'a pas d'état, mais ses jours sont les mêmes.
  assert.deepEqual(doneAfterEdit(tard, { ...tard, kind: "block", from: "09:00", to: "10:00" }), {
    "2026-09-21": true,
    "2026-09-25": true,
  });
});

test("série courte devenue ponctuelle à la date de son dernier jour : elle garde son état", () => {
  // Série d'un seul jour, le 29, faite le 30 après report.
  const unJour = serie({ title: "un jour", start: "2026-09-29", until: "2026-09-29", done: { [TODAY]: true } });
  const ponctuelle = { ...unJour, recur: "none", until: undefined };
  ponctuelle.done = doneAfterEdit(unJour, ponctuelle);
  assert.deepEqual(ponctuelle.done, { [TODAY]: true });
  assert.equal(taskDone(ponctuelle, "2026-09-29"), true);
  assert.equal(isCarrying(ponctuelle, TODAY), false);
  // Du 27 au 29, le 29 fait le 30 : ponctuelle du 29, toujours faite ; ponctuelle du 28, à refaire.
  const fait = serie({ ...TROIS, done: { "2026-09-27": true, [TODAY]: true } });
  assert.deepEqual(doneAfterEdit(fait, { ...fait, recur: "none", start: "2026-09-29" }), { [TODAY]: true });
  assert.deepEqual(doneAfterEdit(fait, { ...fait, recur: "none", start: "2026-09-28" }), {});
  assert.deepEqual(doneAfterEdit(fait, { ...fait, recur: "none", start: "2026-09-27" }), { "2026-09-27": true });
  // Dernier jour jamais fait : la ponctuelle est à faire.
  assert.deepEqual(doneAfterEdit(serie(TROIS), { ...serie(TROIS), recur: "none", start: "2026-09-29" }), {});
});

test("retirer un jour d'une série efface ses coches, et la coche tardive si c'était le dernier jour", () => {
  const fait = serie({ ...TROIS, done: { "2026-09-27": true, "2026-09-28": true, [TODAY]: true } });
  // Un jour ordinaire : seule sa coche part ; le dernier jour reste fait après report.
  assert.deepEqual(doneAfterSkip(fait, "2026-09-28"), { "2026-09-27": true, [TODAY]: true });
  // Le dernier jour : la coche du 30, qui le concernait, part avec lui. Le 28 garde la sienne.
  const apres = { ...fait, done: doneAfterSkip(fait, "2026-09-29"), skipped: { "2026-09-29": true } };
  assert.deepEqual(apres.done, { "2026-09-27": true, "2026-09-28": true });
  assert.equal(carryDay(apres), "2026-09-28");
  assert.equal(doneDay(apres), "2026-09-28");
  assert.deepEqual(carriedFor([apres], TODAY, TODAY), [], "rien n'est attribué au nouveau dernier jour");
  // Habitude : rien d'autre que la coche du jour retiré.
  const habitude = serie({ title: "h", start: "2026-09-01", done: { "2026-09-28": true, "2026-09-29": true } });
  assert.deepEqual(doneAfterSkip(habitude, "2026-09-28"), { "2026-09-29": true });
});

test("série raccourcie : les coches posées après la nouvelle fin partent avec ces jours", () => {
  // Habitude commencée samedi, cochée jusqu'à aujourd'hui, puis arrêtée à hier.
  const habitude = serie({
    title: "h",
    start: "2026-09-26",
    done: { "2026-09-28": true, "2026-09-29": true, [TODAY]: true },
  });
  const arretee = { ...habitude, until: "2026-09-29" };
  arretee.done = doneAfterEdit(habitude, arretee);
  assert.deepEqual(arretee.done, { "2026-09-28": true, "2026-09-29": true });
  assert.equal(doneDay(arretee), "2026-09-29", "faite à temps, pas « après report »");
  assert.deepEqual(carriedFor([arretee], TODAY, TODAY), [], "pas de trace fantôme aujourd'hui");
  // Arrêtée à avant-hier, dont le dernier jour n'a pas été fait : il se reporte, sans coche héritée.
  const plusTot = { ...habitude, done: { "2026-09-29": true, [TODAY]: true }, until: "2026-09-28" };
  plusTot.done = doneAfterEdit({ ...habitude, done: plusTot.done }, plusTot);
  assert.deepEqual(plusTot.done, {});
  assert.equal(isCarrying(plusTot, TODAY), true);
  // Série courte raccourcie : même règle.
  const courte = serie({ ...TROIS, done: { "2026-09-28": true, "2026-09-29": true } });
  assert.deepEqual(doneAfterEdit(courte, { ...courte, until: "2026-09-28" }), { "2026-09-28": true });
});

test("série courte : décocher le dernier jour fait à temps le remet à faire, sans toucher aux autres", () => {
  const it = serie({ ...TROIS, done: { "2026-09-27": true, "2026-09-29": true } });
  assert.deepEqual(doneAfterToggle(it, "2026-09-29"), { "2026-09-27": true });
  // Même résultat depuis le jour où elle s'afficherait reportée.
  assert.deepEqual(doneAfterToggle(it, TODAY), { "2026-09-27": true });
});
