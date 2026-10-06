// Séries courtes (une fin, sept jours au plus) : traitées comme des éléments ponctuels.
// Et retour du focus clavier à la fermeture d'une fenêtre.
import { test, expect } from "./fixtures.js";

// Mercredi 30 septembre 2026, 10 h : la semaine affichée va du lundi 28 au dimanche 4.
const NOW = new Date("2026-09-30T10:00:00");
const TODAY = "2026-09-30";
const mk = (o) => ({ id: crypto.randomUUID(), kind: "task", recur: "none", cat: "ambre", done: {}, skipped: {}, ...o });
const todo = (page, day) => page.locator(".todo.day").nth((new Date(day).getUTCDay() + 6) % 7);
const cell = (page, day) => page.locator(`.month .mc[data-add="${day}"]`);

/** Ouvre la démo avec ces éléments, à la date donnée. */
async function open(page, items, { now = NOW, prefs = {} } = {}) {
  await page.clock.setFixedTime(now);
  await page.addInitScript(
    ([list, stored]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("semainier.demo.v1", JSON.stringify(list));
      for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
    },
    [items, prefs],
  );
  await page.goto("/#demo");
  await expect(page.locator("#app")).toBeVisible();
}

test.afterEach(async ({ errors }) => {
  expect(errors).toEqual([]);
});

test.describe("séries courtes", () => {
  const COURTE = mk({ title: "Réviser", start: "2026-10-01", recur: "daily", until: "2026-10-03" });
  const HABITUDE = mk({ title: "Étirements", start: "2026-10-01", recur: "daily", until: "2026-10-08" });

  test("dans le mois : écrite chaque jour, quand une série de huit jours reste une marque", async ({ page }) => {
    // Jeudi 1er octobre : le mois affiché est octobre.
    await open(page, [COURTE, HABITUDE], {
      now: new Date("2026-10-01T10:00:00"),
      prefs: { "semainier.view": "month" },
    });
    for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
      await expect(cell(page, day).locator(".chip")).toHaveText(["Réviser↻"]);
      await expect(cell(page, day).locator(".routine")).toHaveAttribute("title", "Habitudes : Étirements");
    }
    await expect(cell(page, "2026-10-04").locator(".chip")).toHaveCount(0);
    await expect(cell(page, "2026-10-08").locator(".routine")).toHaveCount(1);
    await expect(cell(page, "2026-10-09").locator(".routine")).toHaveCount(0);
  });

  test("dans « À venir » : une ligne par jour, les jours faits en sortent, l'habitude n'y est pas", async ({
    page,
  }) => {
    await open(page, [COURTE, HABITUDE], { prefs: { "semainier.view": "month", "semainier.upcoming": "1" } });
    const lines = page.locator(".agenda .up");
    await expect(lines).toHaveCount(3);
    await expect(page.locator(".agenda")).not.toContainText("Étirements");
    await lines.nth(1).getByRole("checkbox").click();
    await expect(lines).toHaveCount(2);
    await expect(cell(page, "2026-10-02").locator(".chip.done")).toHaveCount(1);
    // Chaque jour vaut pour lui seul : les deux autres restent à faire.
    await expect(cell(page, "2026-10-01").locator(".chip.done")).toHaveCount(0);
    await expect(cell(page, "2026-10-03").locator(".chip.done")).toHaveCount(0);
  });

  test.describe("report du dernier jour", () => {
    // Du dimanche 27 au mardi 29 : finie hier, aucun jour coché.
    const FINIE = mk({ title: "Trois soirs", start: "2026-09-27", recur: "daily", until: "2026-09-29" });

    test("le dernier jour non fait se reporte à aujourd'hui, pas les jours d'avant", async ({ page }) => {
      await open(page, [FINIE]);
      const carried = todo(page, TODAY).locator("li.carried");
      await expect(carried).toHaveCount(1);
      await expect(carried).toContainText("Trois soirs");
      await expect(carried).toContainText("depuis mar. 29");
      await expect(page.locator("#bar")).toContainText("Tâches du jour : 0/1");
      // Lundi 28 : une occurrence ordinaire, non faite, sans marque de report. Mardi 29 : la marque.
      await expect(todo(page, "2026-09-28").getByRole("img", { name: "Reportée à aujourd'hui" })).toHaveCount(0);
      await expect(todo(page, "2026-09-29").getByRole("img", { name: "Reportée à aujourd'hui" })).toHaveCount(1);
    });

    test("la cocher après report marque aussi le dernier jour, et le dit", async ({ page }) => {
      await open(page, [FINIE]);
      await todo(page, TODAY).getByRole("checkbox").click();
      await expect(page.locator("#bar")).toContainText("Tâches du jour : 1/1");
      await expect(todo(page, TODAY).locator("li.carried.done")).toContainText("prévue mar. 29");
      await expect(todo(page, "2026-09-29").locator("li.done")).toHaveCount(1);
      await expect(todo(page, "2026-09-28").locator("li.done")).toHaveCount(0);

      await page.reload();
      await todo(page, "2026-09-29").getByRole("button", { name: "Trois soirs", exact: true }).click();
      await expect(page.locator("#detMeta")).toContainText("mardi 29 septembre");
      await expect(page.locator("#detMeta")).toContainText("Faite le mercredi 30 septembre, après report");
      // Remise à faire depuis son jour prévu : elle se reporte de nouveau.
      await page.getByRole("button", { name: "Remettre à faire" }).click();
      await expect(todo(page, TODAY).locator("li.carried:not(.done)")).toHaveCount(1);
    });

    test("ouverte depuis le jour où elle est reportée : sa date prévue, et pas de « Retirer ce jour »", async ({
      page,
    }) => {
      await open(page, [FINIE]);
      await todo(page, TODAY).getByRole("button", { name: "Trois soirs", exact: true }).click();
      await expect(page.locator("#detMeta")).toContainText("mardi 29 septembre");
      await expect(page.locator("#detMeta")).toContainText("reportée à aujourd'hui");
      await expect(page.getByRole("button", { name: "Retirer ce jour" })).toBeHidden();
      await page.keyboard.press("Escape");
      // Depuis son propre jour, on peut la retirer : le report passe alors au jour d'avant.
      await todo(page, "2026-09-29").getByRole("button", { name: "Trois soirs", exact: true }).click();
      await page.getByRole("button", { name: "Retirer ce jour" }).click();
      await expect(todo(page, TODAY).locator("li.carried")).toContainText("depuis lun. 28");
    });

    test("dernier jour fait après report puis retiré : aucune trace attribuée au jour d'avant", async ({ page }) => {
      await open(page, [FINIE]);
      await todo(page, TODAY).getByRole("checkbox").click();
      await expect(todo(page, TODAY).locator("li.carried.done")).toHaveCount(1);
      await todo(page, "2026-09-29").getByRole("button", { name: "Trois soirs", exact: true }).click();
      await page.getByRole("button", { name: "Retirer ce jour" }).click();
      // Le dernier jour est maintenant le lundi 28, jamais fait : c'est lui qui se reporte.
      await expect(todo(page, "2026-09-29")).not.toContainText("Trois soirs");
      await expect(todo(page, TODAY).locator("li.carried.done")).toHaveCount(0);
      await expect(todo(page, TODAY).locator("li.carried")).toContainText("depuis lun. 28");
      await expect(todo(page, "2026-09-28").locator("li.done")).toHaveCount(0);
    });

    test("habitude cochée aujourd'hui puis arrêtée à hier : pas de tâche fantôme aujourd'hui", async ({ page }) => {
      const habit = mk({ title: "Lecture", start: "2026-09-27", recur: "daily", done: { "2026-09-29": true } });
      await open(page, [habit]);
      await todo(page, TODAY).getByRole("checkbox").click();
      await todo(page, TODAY).getByRole("button", { name: "Lecture", exact: true }).click();
      await page.getByRole("button", { name: "Modifier" }).click();
      await page.getByLabel("Jusqu'au").fill("2026-09-29");
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(todo(page, TODAY)).not.toContainText("Lecture");
      await expect(page.locator("#bar")).toContainText("Aucune tâche aujourd'hui");
      // Hier reste fait, à sa date, sans mention de report.
      await todo(page, "2026-09-29").getByRole("button", { name: "Lecture", exact: true }).click();
      await expect(page.locator("#detMeta")).toContainText("État ce jour : faite");
    });

    test("un jour ordinaire de la série : son propre état, sans mention de report", async ({ page }) => {
      // Dernier jour fait après report ; le lundi 28, lui, n'a jamais été fait.
      await open(page, [{ ...FINIE, done: { [TODAY]: true } }]);
      await todo(page, "2026-09-28").getByRole("button", { name: "Trois soirs", exact: true }).click();
      await expect(page.locator("#detMeta")).toContainText("lundi 28 septembre");
      await expect(page.locator("#detMeta")).toContainText("État ce jour : à faire");
      await expect(page.locator("#detMeta")).not.toContainText("report");
      await expect(page.getByRole("button", { name: "Retirer ce jour" })).toBeVisible();
      await page.keyboard.press("Escape");
      // Non faite et en cours de report : la mention ne va que sur le dernier jour.
      await page.evaluate(() => {
        const items = JSON.parse(localStorage.getItem("semainier.demo.v1"));
        items[0].done = {};
        localStorage.setItem("semainier.demo.v1", JSON.stringify(items));
      });
      await page.reload();
      await todo(page, "2026-09-28").getByRole("button", { name: "Trois soirs", exact: true }).click();
      await expect(page.locator("#detMeta")).not.toContainText("reportée");
      await page.keyboard.press("Escape");
      await todo(page, "2026-09-29").getByRole("button", { name: "Trois soirs", exact: true }).click();
      await expect(page.locator("#detMeta")).toContainText("reportée à aujourd'hui");
    });

    test("tâche placée à une heure : la marque du report ne va que sur le dernier jour, dans la grille", async ({
      page,
    }) => {
      await open(page, [{ ...FINIE, from: "18:00", to: "18:30" }]);
      const ev = (day) => page.locator(`.col.day[data-col="${day}"] .ev`);
      await expect(ev("2026-09-28")).toHaveAttribute("aria-label", "Trois soirs, 18:00 à 18:30");
      await expect(ev("2026-09-28")).not.toContainText("↷");
      await expect(ev("2026-09-29")).toHaveAttribute(
        "aria-label",
        "Trois soirs, 18:00 à 18:30, reportée à aujourd'hui",
      );
      await expect(ev("2026-09-29")).toContainText("↷");
      // Reportée, elle perd son heure : elle est dans « À faire » aujourd'hui.
      await expect(todo(page, TODAY).locator("li.carried")).toContainText("Trois soirs");
    });

    test("dernier jour avant la date de fin : la tâche reportée se coche sans attendre la fin", async ({ page }) => {
      // Lundi, mercredi et vendredi, jusqu'au dimanche 4 octobre. Samedi 3 : le vendredi n'est pas fait.
      const lmv = mk({ title: "Kiné", start: "2026-09-28", until: "2026-10-04", recur: "weekly", days: [0, 2, 4] });
      await open(page, [lmv], { now: new Date("2026-10-03T10:00:00") });
      const samedi = todo(page, "2026-10-03");
      await expect(samedi.locator("li.carried")).toContainText("depuis ven. 2");
      await samedi.getByRole("checkbox").click();
      await expect(page.locator("#bar")).toContainText("Tâches du jour : 1/1");
      await expect(samedi.locator("li.carried.done")).toHaveCount(1);
      await expect(todo(page, "2026-10-02").locator("li.done")).toHaveCount(1);
      await samedi.getByRole("checkbox").click();
      await expect(page.locator("#bar")).toContainText("Tâches du jour : 0/1");
    });

    test("série d'un jour faite après report, repassée en « Une seule fois » : elle reste faite", async ({ page }) => {
      const unJour = mk({ title: "Un soir", start: "2026-09-29", until: "2026-09-29", recur: "daily" });
      await open(page, [unJour]);
      await todo(page, TODAY).getByRole("checkbox").click();
      await expect(page.locator("#bar")).toContainText("Tâches du jour : 1/1");
      await todo(page, TODAY).getByRole("button", { name: "Un soir", exact: true }).click();
      await page.getByRole("button", { name: "Modifier" }).click();
      await page.getByLabel("Répétition").selectOption("none");
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.locator("#bar")).toContainText("Tâches du jour : 1/1");
      await expect(todo(page, TODAY).locator("li.carried.done")).toContainText("prévue mar. 29");
    });

    test("une série de huit jours finie hier ne se reporte pas", async ({ page }) => {
      await open(page, [mk({ title: "Huit soirs", start: "2026-09-22", recur: "daily", until: "2026-09-29" })]);
      await expect(todo(page, "2026-09-29")).toContainText("Huit soirs");
      await expect(todo(page, TODAY).locator("li.carried")).toHaveCount(0);
      await expect(page.locator("#bar")).toContainText("Aucune tâche aujourd'hui");
    });

    test("tant que la série n'est pas finie, rater un jour ne reporte rien", async ({ page }) => {
      await open(page, [mk({ title: "En cours", start: "2026-09-28", recur: "daily", until: "2026-09-30" })]);
      await expect(todo(page, TODAY).locator("li.carried")).toHaveCount(0);
      await expect(todo(page, TODAY).locator("li")).toHaveCount(1);
      await expect(todo(page, TODAY).locator("li")).toContainText("En cours");
      await expect(todo(page, TODAY).getByRole("img", { name: "Reportée à aujourd'hui" })).toHaveCount(0);
    });
  });
});

test.describe("retour du focus clavier", () => {
  const ITEM = mk({ title: "Appeler le comptable", start: TODAY });
  /** Ce qui a le focus : son identifiant s'il en a un, sinon son texte. */
  const focused = (page) =>
    page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim());

  test("fermer la fenêtre d'un élément ramène sur cet élément", async ({ page }) => {
    await open(page, [ITEM]);
    const title = todo(page, TODAY).getByRole("button", { name: "Appeler le comptable", exact: true });
    await title.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#detScrim")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => focused(page)).toBe("Appeler le comptable");
  });

  test("du détail au formulaire puis fermeture : toujours l'élément d'origine, redessiné entre-temps", async ({
    page,
  }) => {
    await open(page, [ITEM]);
    await todo(page, TODAY).getByRole("button", { name: "Appeler le comptable", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Modifier" }).click();
    await expect(page.locator("#formScrim")).toBeVisible();
    await page.getByLabel("Intitulé").fill("Appeler le comptable");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect.poll(() => focused(page)).toBe("Appeler le comptable");
  });

  test("après « Demain » : le focus revient sur l'élément d'origine", async ({ page }) => {
    await open(page, [ITEM]);
    await todo(page, TODAY).getByRole("button", { name: "Appeler le comptable", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("group", { name: "Refaire" }).getByRole("button", { name: "Demain" }).click();
    await expect(todo(page, "2026-10-01")).toContainText("Appeler le comptable");
    expect(await page.evaluate(() => document.activeElement?.closest(".todo.day")?.className)).toContain("today");
  });

  test("le bouton « Ajouter » et le menu retrouvent le focus eux aussi", async ({ page }) => {
    await open(page, [ITEM]);
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.keyboard.press("Escape");
    await expect.poll(() => focused(page)).toBe("add");
    // Une entrée du menu disparaît avec lui : on revient au bouton qui l'ouvre.
    await page.getByRole("button", { name: "Plus d'options" }).click();
    await page.getByRole("menuitem", { name: "Renommer les catégories" }).click();
    await expect(page.locator("#catScrim")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => focused(page)).toBe("menuBtn");
  });

  test("un élément montré deux fois (mois et « À venir ») : le focus revient sur le bon exemplaire", async ({
    page,
  }) => {
    const futur = mk({ title: "Dentiste", start: "2026-10-02" });
    await open(page, [futur], { prefs: { "semainier.view": "month", "semainier.upcoming": "1" } });
    const where = () => page.evaluate(() => (document.activeElement?.closest(".agenda") ? "à venir" : "mois"));
    await page.locator(".agenda").getByRole("button", { name: "Dentiste", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#detScrim")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => focused(page)).toBe("Dentiste");
    expect(await where()).toBe("à venir");
    await page.locator(".month").getByRole("button", { name: "Dentiste", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect.poll(() => focused(page)).toBe("Dentiste");
    expect(await where()).toBe("mois");
  });

  test("élément déplacé d'un jour : le focus le suit", async ({ page }) => {
    await open(page, [ITEM]);
    await todo(page, TODAY).getByRole("button", { name: "Appeler le comptable", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Modifier" }).click();
    await page.getByLabel("Date (1re fois)").fill("2026-10-01");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(todo(page, "2026-10-01")).toContainText("Appeler le comptable");
    await expect.poll(() => focused(page)).toBe("Appeler le comptable");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-day"))).toBe("2026-10-01");
  });

  test("fenêtre fermée d'un clic sur le fond : le focus revient quand même", async ({ page }) => {
    await open(page, [ITEM]);
    await todo(page, TODAY).getByRole("button", { name: "Appeler le comptable", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#detScrim")).toBeVisible();
    await page.locator("#detScrim").click({ position: { x: 8, y: 8 } });
    await expect(page.locator("#detScrim")).toBeHidden();
    await expect.poll(() => focused(page)).toBe("Appeler le comptable");
  });

  test("élément supprimé : rien à retrouver, et aucune erreur", async ({ page }) => {
    await open(page, [ITEM]);
    await todo(page, TODAY).getByRole("button", { name: "Appeler le comptable", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Supprimer", exact: true }).click();
    await page.getByRole("button", { name: "Confirmer la suppression" }).click();
    await expect(todo(page, TODAY)).not.toContainText("Appeler le comptable");
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });
});
