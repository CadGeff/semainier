// « Refaire » un élément, fin de série et signalement des chevauchements.
import { test, expect, mockSupabase, login } from "./fixtures.js";

// Mercredi 30 septembre 2026, 10 h : semaine 40, données d'exemple déterministes.
const NOW = new Date("2026-09-30T10:00:00");
const TODAY = "2026-09-30";
const col = (page, day) => page.locator(`.col.day[data-col="${day}"]`);
/** Ligne « À faire » d'un jour de la semaine affichée (du lundi 28 septembre au dimanche 4 octobre). */
const todo = (page, day) => page.locator(".todo.day").nth((new Date(day).getUTCDay() + 6) % 7);
const redo = (page) => page.getByRole("group", { name: "Refaire" });

test.afterEach(async ({ errors }) => {
  expect(errors).toEqual([]);
});

test.describe("démo", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await page.goto("/#demo");
    await expect(page.locator(".ev").first()).toBeVisible();
  });

  test("« Demain » copie une tâche au lendemain en un clic", async ({ page }) => {
    await col(page, TODAY).locator(".ev", { hasText: "Appeler le comptable" }).click();
    await redo(page).getByRole("button", { name: "Demain" }).click();

    await expect(page.locator("#detScrim")).toBeHidden();
    await expect(page.locator(".toast-msg").last()).toHaveText("« Appeler le comptable » : copie créée pour demain.");
    const copy = col(page, "2026-10-01").locator(".ev.task", { hasText: "Appeler le comptable" });
    await expect(copy).toContainText("16:00–16:30");
    await expect(col(page, TODAY).locator(".ev", { hasText: "Appeler le comptable" })).toHaveCount(1);

    // La copie est un élément à part : une seule fois, non cochée, et elle survit au rechargement.
    await page.reload();
    await col(page, "2026-10-01").locator(".ev", { hasText: "Appeler le comptable" }).click();
    await expect(page.locator("#detMeta")).toContainText("jeudi 1 octobre");
    await expect(page.locator("#detMeta")).toContainText("Une seule fois");
    await expect(page.locator("#detMeta")).toContainText("État : à faire");
  });

  test("un élément à venir est refait le lendemain de sa date, et le bouton le dit", async ({ page }) => {
    await todo(page, "2026-10-03").getByRole("button", { name: "Courses", exact: true }).click();
    const btn = redo(page).getByRole("button").first();
    await expect(btn).toHaveText("Dim. 4 oct.");
    await btn.click();
    await expect(page.locator(".toast-msg").last()).toHaveText("« Courses » : copie créée pour le dimanche 4 octobre.");
    await expect(todo(page, "2026-10-04")).toContainText("Courses");
    // « Courses » revient chaque samedi : la copie, elle, ne se répète pas.
    await todo(page, "2026-10-04").getByRole("button", { name: "Courses", exact: true }).click();
    await expect(page.locator("#detMeta")).toContainText("Une seule fois");
  });

  test("un créneau refait sur un créneau existant : la copie est créée, le chevauchement signalé", async ({ page }) => {
    await col(page, TODAY).locator(".ev", { hasText: "Deep work" }).click();
    await redo(page).getByRole("button", { name: "Demain" }).click();

    const toast = page.locator(".toast").last();
    await expect(toast.locator(".toast-msg")).toHaveText(
      "« Deep work » : copie créée pour demain. Chevauche « Deep work » (09:00–11:00) le jeudi 1 octobre.",
    );
    // Le signalement ne disparaît pas seul.
    await expect(toast.getByRole("button", { name: "OK" })).toBeVisible();
    await expect(col(page, "2026-10-01").locator(".ev.block", { hasText: "Deep work" })).toHaveCount(2);
  });

  test("un créneau refait sur une plage libre ne signale rien", async ({ page }) => {
    await col(page, TODAY).locator(".ev", { hasText: "Cours d'anglais" }).click();
    await redo(page).getByRole("button", { name: "Demain" }).click();
    const toast = page.locator(".toast").last();
    await expect(toast.locator(".toast-msg")).toHaveText("« Cours d'anglais » : copie créée pour demain.");
    await expect(toast.getByRole("button", { name: "OK" })).toBeHidden();
    await expect(col(page, "2026-10-01").locator(".ev.block", { hasText: "Cours d'anglais" })).toContainText(
      "14:00–15:30",
    );
  });

  test("« Autre date… » ouvre le formulaire prérempli, où tout reste modifiable", async ({ page }) => {
    await col(page, TODAY).locator(".ev", { hasText: "Appeler le comptable" }).click();
    await redo(page).getByRole("button", { name: "Autre date…" }).click();

    await expect(page.locator("#formTitle")).toHaveText("Refaire « Appeler le comptable »");
    await expect(page.getByLabel("Intitulé")).toHaveValue("Appeler le comptable");
    await expect(page.getByLabel("Date (1re fois)")).toHaveValue("2026-10-01");
    await expect(page.getByLabel("Début")).toHaveValue("16:00");
    await expect(page.getByLabel("Fin", { exact: true })).toHaveValue("16:30");
    await expect(page.locator("#f-kind-task")).toBeChecked();
    await expect(page.locator("#f-cat-ambre")).toBeChecked();
    await expect(page.getByLabel("Répétition")).toHaveValue("none");
    // Une création, pas une modification : pas de bouton « Supprimer ».
    await expect(page.locator("#f-delete")).toBeHidden();

    await page.getByLabel("Intitulé").fill("Rappeler le comptable");
    await page.locator('label[data-cat="rose"]').click();
    await page.getByLabel("Date (1re fois)").fill("2026-10-02");
    await page.getByRole("button", { name: "Enregistrer" }).click();

    const copy = col(page, "2026-10-02").locator(".ev", { hasText: "Rappeler le comptable" });
    await expect(copy).toHaveAttribute("data-cat", "rose");
    // L'original garde son intitulé, sa catégorie et sa date.
    const original = col(page, TODAY).locator(".ev", { hasText: "Appeler le comptable" });
    await expect(original).toHaveCount(1);
    await expect(original).toHaveAttribute("data-cat", "ambre");
  });

  test("« Autre date… » sur un créneau d'une série : type, catégorie et heures repris, sans la répétition", async ({
    page,
  }) => {
    // « Sport » revient les mardis, jeudis et samedis, en vert.
    await col(page, "2026-10-01").locator(".ev", { hasText: "Sport" }).click();
    await redo(page).getByRole("button", { name: "Autre date…" }).click();
    await expect(page.locator("#f-kind-block")).toBeChecked();
    await expect(page.locator("#f-cat-vert")).toBeChecked();
    await expect(page.getByLabel("Date (1re fois)")).toHaveValue("2026-10-02");
    await expect(page.getByLabel("Début")).toHaveValue("18:30");
    await expect(page.getByLabel("Fin", { exact: true })).toHaveValue("19:30");
    await expect(page.getByLabel("Répétition")).toHaveValue("none");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(col(page, "2026-10-02").locator(".ev.block", { hasText: "Sport" })).toHaveCount(1);
  });

  test("annuler « Autre date… » ne crée rien", async ({ page }) => {
    const before = await page.locator(".ev").count();
    await col(page, TODAY).locator(".ev", { hasText: "Appeler le comptable" }).click();
    await redo(page).getByRole("button", { name: "Autre date…" }).click();
    await page.getByRole("button", { name: "Annuler" }).click();
    expect(await page.locator(".ev").count()).toBe(before);
  });

  test("refaire pendant trois jours : une série qui s'arrête le troisième jour", async ({ page }) => {
    await col(page, TODAY).locator(".ev", { hasText: "Appeler le comptable" }).click();
    await redo(page).getByRole("button", { name: "Autre date…" }).click();

    // Le champ de fin n'existe que pour une répétition.
    await expect(page.locator("#untilField")).toBeHidden();
    await page.getByLabel("Répétition").selectOption("daily");
    await expect(page.locator("#untilField")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sans fin" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "3 jours" }).click();
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("2026-10-03");
    await expect(page.getByRole("button", { name: "3 jours" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Sans fin" })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Enregistrer" }).click();

    for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"])
      await expect(col(page, day).locator(".ev", { hasText: "Appeler le comptable" })).toHaveCount(1);
    await expect(col(page, "2026-10-04").locator(".ev", { hasText: "Appeler le comptable" })).toHaveCount(0);

    await page.reload();
    await col(page, "2026-10-03").locator(".ev", { hasText: "Appeler le comptable" }).click();
    await expect(page.locator("#detMeta")).toContainText("Chaque jour, jusqu'au 3 octobre");
  });

  test("la fin suit la date de départ, les raccourcis en jours ne valent que pour « Chaque jour »", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.getByLabel("Date (1re fois)").fill("2026-10-05");
    await page.getByLabel("Répétition").selectOption("daily");
    await page.getByRole("button", { name: "1 semaine" }).click();
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("2026-10-11");

    // Départ repoussé de trois jours : la série dure toujours une semaine.
    await page.getByLabel("Date (1re fois)").fill("2026-10-08");
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("2026-10-14");
    await expect(page.getByRole("button", { name: "1 semaine" })).toHaveAttribute("aria-pressed", "true");

    // Une date saisie à la main qui ne correspond à aucun raccourci.
    await page.getByLabel("Jusqu'au").fill("2026-10-30");
    await expect(page.getByRole("button", { name: "1 semaine" })).toHaveAttribute("aria-pressed", "false");

    await page.getByLabel("Répétition").selectOption("weekly");
    await expect(page.getByRole("button", { name: "3 jours" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Sans fin" })).toBeVisible();
    await page.getByRole("button", { name: "Sans fin" }).click();
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("");
  });

  test("retaper l'année de départ au clavier ne fait pas perdre la fin de la série", async ({ page }) => {
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.getByLabel("Date (1re fois)").fill("2026-10-05");
    await page.getByLabel("Répétition").selectOption("daily");
    await page.getByRole("button", { name: "1 semaine" }).click();

    // Au clavier, le champ passe par les années 0002, 0020 et 0202 avant d'arriver à 2027.
    await page.getByLabel("Date (1re fois)").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("2027");
    await expect(page.getByLabel("Date (1re fois)")).toHaveValue("2027-10-05");
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("2027-10-11");
    await expect(page.getByRole("button", { name: "1 semaine" })).toHaveAttribute("aria-pressed", "true");
  });

  test("date de départ effacée puis ressaisie : la série garde sa durée", async ({ page }) => {
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.getByLabel("Date (1re fois)").fill("2026-10-05");
    await page.getByLabel("Répétition").selectOption("daily");
    await page.getByRole("button", { name: "2 jours" }).click();
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("2026-10-06");

    await page.getByLabel("Date (1re fois)").fill("");
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("2026-10-06");
    // Sans date de départ, aucune durée ne peut être affirmée : aucun raccourci n'est enfoncé.
    for (const name of ["2 jours", "3 jours", "1 semaine", "Sans fin"])
      await expect(page.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    await page.getByLabel("Date (1re fois)").fill("2026-10-20");
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("2026-10-21");
    await expect(page.getByRole("button", { name: "2 jours" })).toHaveAttribute("aria-pressed", "true");
  });

  test("une série d'un seul jour est acceptée ; « Sans fin » n'est enfoncé que sans date de fin", async ({ page }) => {
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.getByLabel("Intitulé").fill("Un seul jour");
    await page.getByLabel("Date (1re fois)").fill("2026-10-01");
    await page.getByLabel("Répétition").selectOption("daily");
    await page.getByLabel("Jusqu'au").fill("2026-09-30");
    await expect(page.getByRole("button", { name: "Sans fin" })).toHaveAttribute("aria-pressed", "false");
    await page.getByLabel("Jusqu'au").fill("2026-10-01");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("#formScrim")).toBeHidden();
    await expect(todo(page, "2026-10-01")).toContainText("Un seul jour");
    await expect(todo(page, "2026-10-02")).not.toContainText("Un seul jour");
  });

  test("une fin qui ne laisse aucun jour à la série est refusée", async ({ page }) => {
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.getByLabel("Intitulé").fill("Piscine");
    // Jeudi 1er octobre, seul le vendredi coché, fin le jeudi : aucun vendredi dans l'intervalle.
    await page.getByLabel("Date (1re fois)").fill("2026-10-01");
    await page.getByLabel("Répétition").selectOption("weekly");
    await page.locator("#f-d3").uncheck({ force: true });
    await page.locator("#f-d4").check({ force: true });
    await page.getByLabel("Jusqu'au").fill("2026-10-01");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("#formErr")).toHaveText(
      "Avec cette date de fin, la série n'a aucun jour. Repousse la fin, ou change les jours.",
    );
    await page.getByLabel("Jusqu'au").fill("2026-10-02");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(todo(page, "2026-10-02")).toContainText("Piscine");
  });

  test("retirer le dernier jour d'une série qui a une fin la supprime", async ({ page }) => {
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.getByLabel("Intitulé").fill("Deux jours");
    await page.getByLabel("Date (1re fois)").fill("2026-10-01");
    await page.getByLabel("Répétition").selectOption("daily");
    await page.getByRole("button", { name: "2 jours" }).click();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    const stored = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("semainier.demo.v1")).filter((it) => it.title === "Deux jours"),
      );

    await todo(page, "2026-10-01").getByRole("button", { name: "Deux jours", exact: true }).click();
    await page.getByRole("button", { name: "Retirer ce jour" }).click();
    await expect(todo(page, "2026-10-01")).not.toContainText("Deux jours");
    await expect(todo(page, "2026-10-02")).toContainText("Deux jours");
    expect(await stored()).toHaveLength(1);

    // Il ne resterait qu'une série sans aucun jour, que rien ne permettrait de rouvrir.
    await todo(page, "2026-10-02").getByRole("button", { name: "Deux jours", exact: true }).click();
    await page.getByRole("button", { name: "Retirer ce jour" }).click();
    await expect(page.locator(".toast-msg").last()).toHaveText(
      "« Deux jours » : c'était le dernier jour de la série, elle est supprimée.",
    );
    await expect.poll(async () => (await stored()).length).toBe(0);
  });

  test("une fin antérieure au premier jour est refusée", async ({ page }) => {
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.getByLabel("Intitulé").fill("Série à l'envers");
    await page.getByLabel("Date (1re fois)").fill("2026-10-05");
    await page.getByLabel("Répétition").selectOption("daily");
    await page.getByLabel("Jusqu'au").fill("2026-10-04");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("#formErr")).toHaveText("La série ne peut pas finir avant son premier jour.");
    await expect(page.locator("#formScrim")).toBeVisible();
  });

  test("arrêter une série existante garde ce qui a été coché", async ({ page }) => {
    await todo(page, TODAY).getByRole("checkbox", { name: "Marquer « Lire 20 pages » comme faite" }).click();
    await todo(page, TODAY).getByRole("button", { name: "Lire 20 pages", exact: true }).click();
    await page.getByRole("button", { name: "Modifier" }).click();
    await page.getByLabel("Jusqu'au").fill("2026-10-01");
    await page.getByRole("button", { name: "Enregistrer" }).click();

    await expect(todo(page, "2026-10-01")).toContainText("Lire 20 pages");
    await expect(todo(page, "2026-10-02")).not.toContainText("Lire 20 pages");
    await expect(todo(page, TODAY).locator("li.done")).toContainText(["Lire 20 pages"]);

    // Repasser à « Une seule fois » efface la date de fin : elle ne revient pas si on rouvre la série.
    await todo(page, TODAY).getByRole("button", { name: "Lire 20 pages", exact: true }).click();
    await page.getByRole("button", { name: "Modifier" }).click();
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("2026-10-01");
    await page.getByLabel("Répétition").selectOption("none");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await page.locator("[data-open]", { hasText: "Lire 20 pages" }).first().click();
    await page.getByRole("button", { name: "Modifier" }).click();
    await page.getByLabel("Répétition").selectOption("daily");
    await expect(page.getByLabel("Jusqu'au")).toHaveValue("");
  });

  test("le formulaire signale un créneau qui en recouvre un autre, sans empêcher de l'enregistrer", async ({
    page,
  }) => {
    const hint = page.locator("#clashHint");
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.getByLabel("Intitulé").fill("Dentiste");
    await page.getByLabel("Date (1re fois)").fill("2026-10-01");
    await page.getByLabel("Début").fill("10:30");
    await page.getByLabel("Fin", { exact: true }).fill("11:45");
    // Une tâche placée à une heure peut se faire pendant un créneau : rien à signaler.
    await expect(hint).toBeHidden();

    await page.getByText("Créneau bloqué", { exact: true }).click();
    await expect(hint).toHaveText("Chevauche « Deep work » (09:00–11:00) et 1 autre créneau le jeudi 1 octobre.");

    // Décalé juste après « Deep work » et juste avant « Point d'équipe » : plus rien.
    await page.getByLabel("Début").fill("11:00");
    await page.getByLabel("Fin", { exact: true }).fill("11:30");
    await expect(hint).toBeHidden();

    // En série quotidienne, les autres jours sont examinés aussi.
    await page.getByLabel("Début").fill("10:00");
    await page.getByLabel("Répétition").selectOption("daily");
    await page.getByRole("button", { name: "3 jours" }).click();
    await expect(hint).toHaveText(
      "Chevauche « Deep work » (09:00–11:00) le jeudi 1 octobre, et d'autres créneaux sur 1 autre jour.",
    );

    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("#formScrim")).toBeHidden();
    await expect(col(page, "2026-10-01").locator(".ev.block", { hasText: "Dentiste" })).toBeVisible();
  });

  test("le signalement suit les raccourcis de durée et ne reste pas d'une ouverture à l'autre", async ({ page }) => {
    const hint = page.locator("#clashHint");
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await page.getByText("Créneau bloqué", { exact: true }).click();
    await page.getByLabel("Date (1re fois)").fill("2026-10-01");
    // 08:45–09:00 touche « Deep work » sans le recouvrir ; une demi-heure de plus le recouvre.
    await page.getByLabel("Début").fill("08:45");
    await page.getByRole("button", { name: "15 min" }).click();
    await expect(hint).toBeHidden();
    await page.getByRole("button", { name: "30 min" }).click();
    await expect(hint).toContainText("Chevauche « Deep work »");

    await page.getByRole("button", { name: "Annuler" }).click();
    await page.getByRole("button", { name: "Ajouter un élément" }).click();
    await expect(hint).toBeHidden();
  });

  test("un jour retiré de la série modifiée n'est pas signalé", async ({ page }) => {
    // « Cours d'anglais » (mercredi 14:00–15:30) est déplacé sur « Deep work », le mercredi.
    const edit = async () => {
      await page.locator("[data-open]", { hasText: "Cours d'anglais" }).first().click();
      await page.getByRole("button", { name: "Modifier" }).click();
    };
    await edit();
    await page.getByLabel("Début").fill("10:00");
    await page.getByLabel("Fin", { exact: true }).fill("11:30");
    await page.getByLabel("Jusqu'au").fill("2026-10-07");
    await expect(page.locator("#clashHint")).toHaveText(
      "Chevauche « Deep work » (09:00–11:00) le mercredi 30 septembre, et d'autres créneaux sur 1 autre jour.",
    );
    await page.getByRole("button", { name: "Enregistrer" }).click();

    // On retire le cours d'aujourd'hui : il ne reste que le chevauchement de mercredi prochain.
    await col(page, TODAY).locator(".ev", { hasText: "Cours d'anglais" }).click();
    await page.getByRole("button", { name: "Retirer ce jour" }).click();
    await page.getByRole("button", { name: "Suivant" }).click();
    await edit();
    await expect(page.locator("#clashHint")).toHaveText("Chevauche « Deep work » (09:00–11:00) le mercredi 7 octobre.");
  });

  test("modifier un créneau ne le signale pas contre lui-même", async ({ page }) => {
    await col(page, TODAY).locator(".ev", { hasText: "Cours d'anglais" }).click();
    await page.getByRole("button", { name: "Modifier" }).click();
    await expect(page.locator("#clashHint")).toBeHidden();
    await page.getByLabel("Début").fill("10:00");
    await expect(page.locator("#clashHint")).toContainText("Chevauche « Deep work » (09:00–11:00)");
  });
});

test.describe("avec Supabase", () => {
  const row = (o) => ({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Lecture",
    kind: "task",
    start_date: "2026-09-28",
    until_date: null,
    time_from: null,
    time_to: null,
    recur: "daily",
    days: null,
    cat: "gris",
    done: {},
    skipped: {},
    ...o,
  });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });

  test("la fin d'une série est lue depuis la base", async ({ page }) => {
    await mockSupabase(page, { items: [row({ until_date: "2026-10-01" })] });
    await login(page);
    await expect(todo(page, "2026-10-01")).toContainText("Lecture");
    await expect(todo(page, "2026-10-02")).not.toContainText("Lecture");
  });

  test("base pas encore mise à niveau : le message dit de relancer le script", async ({ page }) => {
    await mockSupabase(page, { items: [row({})] });
    // Réponse de Postgres quand la colonne until_date n'existe pas encore.
    await page.route("**/rest/v1/items**", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ code: "42703", message: "column items.until_date does not exist" }),
      }),
    );
    await login(page);
    await expect(page.locator(".toast-msg").last()).toHaveText(
      "La base de données n'est pas à jour : relance supabase/schema.sql dans le SQL Editor de Supabase, puis recharge la page.",
    );
  });

  test("base pas encore mise à niveau : l'enregistrement le dit aussi", async ({ page }) => {
    await mockSupabase(page, { items: [row({})] });
    await login(page);
    await expect(todo(page, TODAY)).toContainText("Lecture");
    await page.route("**/rest/v1/items**", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 400,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify({ code: "PGRST204", message: "Could not find the 'until_date' column of 'items'" }),
          })
        : route.fallback(),
    );
    await todo(page, TODAY).getByRole("checkbox", { name: "Marquer « Lecture » comme faite" }).click();
    await expect(page.locator(".toast-msg").last()).toHaveText(
      "La base de données n'est pas à jour : relance supabase/schema.sql dans le SQL Editor de Supabase, puis recharge la page.",
    );
  });

  test("la fin d'une série est envoyée à la base, et une copie n'en a pas", async ({ page }) => {
    const s = await mockSupabase(page, { items: [row({})] });
    await login(page);
    await todo(page, TODAY).getByRole("button", { name: "Lecture", exact: true }).click();
    await page.getByRole("button", { name: "Modifier" }).click();
    await page.getByLabel("Jusqu'au").fill("2026-10-02");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect.poll(() => s.items[0].until_date).toBe("2026-10-02");

    await todo(page, TODAY).getByRole("button", { name: "Lecture", exact: true }).click();
    await redo(page).getByRole("button", { name: "Demain" }).click();
    await expect.poll(() => s.items.length).toBe(2);
    const copy = s.items[1];
    expect(copy.id).not.toBe(s.items[0].id);
    expect([copy.title, copy.start_date, copy.until_date, copy.recur, copy.done, copy.skipped]).toEqual([
      "Lecture",
      "2026-10-01",
      null,
      "none",
      {},
      {},
    ]);
  });
});
