// Identité visuelle : lisibilité de ce qui est posé sur le bandeau et sur la page, en clair et en sombre.
import { test, expect } from "./fixtures.js";

const NOW = new Date("2026-09-30T10:00:00");

/**
 * Textes posés sur le bandeau ou directement sur la page (pas sur une feuille) dont le contraste
 * est sous le seuil recommandé : 4,5 pour un texte courant, 3 pour un grand texte.
 */
const lowContrast = () => {
  const rgba = (s) => {
    const m = s.match(/[\d.]+/g).map(Number);
    return m.length >= 4 ? m : [...m, 1];
  };
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const probe = document.createElement("i");
  probe.style.color = "var(--band)";
  document.body.append(probe);
  const band = rgba(getComputedStyle(probe).color);
  probe.remove();
  const page = rgba(getComputedStyle(document.body).backgroundColor);

  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const el = node.parentElement;
    if (!node.textContent.trim() || !el.getClientRects().length) continue;
    // Fond effectif : le bandeau si on est dans l'en-tête, la page si aucun ancêtre n'a de fond.
    let bg = page;
    let own = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (rgba(getComputedStyle(a).backgroundColor)[3] > 0) own = true;
      if (a.classList.contains("top")) bg = band;
      if (own) break;
    }
    if (own) continue;
    const style = getComputedStyle(el);
    const [hi, lo] = [lum(rgba(style.color)), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) found.push(`${ratio.toFixed(2)} « ${node.textContent.trim().slice(0, 30)} »`);
  }
  return found;
};

for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
  for (const [name, width] of /** @type {const} */ ([
    ["ordinateur", 1280],
    ["téléphone", 390],
  ])) {
    test.describe(`thème ${colorScheme === "light" ? "clair" : "sombre"}, ${name}`, () => {
      test.use({ colorScheme, viewport: { width, height: 800 } });

      test("les textes du bandeau et de la page sont lisibles, en semaine et en mois", async ({ page, errors }) => {
        await page.clock.setFixedTime(NOW);
        await page.goto("/#demo");
        await expect(page.locator("#wk")).toContainText("S40");
        expect(await page.evaluate(lowContrast)).toEqual([]);
        await page.getByRole("button", { name: "Mois", exact: true }).click();
        await expect(page.locator(".month")).toBeVisible();
        expect(await page.evaluate(lowContrast)).toEqual([]);
        expect(errors).toEqual([]);
      });
    });
  }
}

/**
 * Libellés secondaires qui portent une information : ils doivent rester lisibles, contrairement
 * à ce qui est volontairement atténué (jours passés, tâches faites, jours hors du mois).
 */
const LABELS = [
  ".todo.gut span",
  ".mg",
  ".mc:not(.past):not(.out) .mo",
  ".agenda h3",
  ".ud small",
  ".nothing",
  ".hint:not(.clash)",
  // « depuis mer. 30 » d'une tâche reportée, et le signe ↷ du report.
  ".todo.day:not(.past) .from",
  '.agenda .rec[role="img"]',
  ".menu .who",
];
/** Ce qui reste volontairement atténué : hors du mois, ou passé. */
const DIMMED = [".mc.out .mo", ".mc.past .num"];

/** Contraste le plus faible parmi les éléments visibles qui correspondent à chaque sélecteur. */
const labelContrasts = (selectors) => {
  const rgba = (s) => {
    const m = s.match(/[\d.]+/g).map(Number);
    return m.length >= 4 ? m : [...m, 1];
  };
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // Fond effectif : les fonds translucides des ancêtres, posés sur le premier fond opaque.
  const backdrop = (el) => {
    const layers = [];
    for (let a = el; a; a = a.parentElement) {
      const c = rgba(getComputedStyle(a).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] === 1) break;
    }
    let bg = layers.pop() || [255, 255, 255, 1];
    while (layers.length) {
      const top = layers.pop();
      bg = [0, 1, 2].map((i) => top[i] * top[3] + bg[i] * (1 - top[3]));
    }
    return bg;
  };
  return selectors.map((selector) => {
    const ratios = [...document.querySelectorAll(selector)]
      .filter((el) => el.getClientRects().length && el.textContent.trim())
      .map((el) => {
        const [hi, lo] = [lum(rgba(getComputedStyle(el).color)), lum(backdrop(el))].sort((a, b) => b - a);
        return (hi + 0.05) / (lo + 0.05);
      });
    return { selector, seen: ratios.length, min: ratios.length ? Math.min(...ratios) : null };
  });
};

for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
  test.describe(`thème ${colorScheme === "light" ? "clair" : "sombre"}`, () => {
    test.use({ colorScheme, viewport: { width: 1280, height: 800 } });

    test("les libellés qui portent une information sont lisibles", async ({ page }) => {
      // Jeudi 1er octobre : les tâches ponctuelles de mercredi, non faites, sont reportées à aujourd'hui.
      await page.clock.setFixedTime(new Date("2026-10-01T10:00:00"));
      await page.addInitScript(() => localStorage.setItem("semainier.upcoming", "1"));
      await page.goto("/#demo");
      await expect(page.locator("#wk")).toContainText("S40");
      const seen = new Map();
      const collect = async () => {
        for (const r of await page.evaluate(labelContrasts, LABELS)) {
          if (r.seen) seen.set(r.selector, Math.min(seen.get(r.selector) ?? Infinity, r.min));
        }
      };
      await collect();
      await page.getByRole("button", { name: "Plus d'options" }).click();
      await collect();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Mois", exact: true }).click();
      await expect(page.locator(".agenda")).toBeVisible();
      await collect();
      // L'atténuation voulue est toujours là : elle ne doit pas disparaître en fonçant les libellés.
      for (const r of await page.evaluate(labelContrasts, DIMMED)) {
        expect(r.seen, r.selector).toBeGreaterThan(0);
        expect(r.min, r.selector).toBeLessThan(4.5);
      }
      await page.getByRole("button", { name: "Suivant" }).click();
      await collect();
      // Sur écran étroit, la semaine en liste : « Rien de particulier » sur les jours vides.
      await page.setViewportSize({ width: 390, height: 800 });
      await page.getByRole("button", { name: "Semaine", exact: true }).click();
      await expect(page.locator(".wlist")).toBeVisible();
      await collect();
      await page.locator("#add").click();
      await expect(page.locator("#timeHint")).toBeVisible();
      await collect();
      // Chaque libellé a bien été rencontré, et aucun n'est sous le seuil.
      expect([...seen.keys()].sort()).toEqual([...LABELS].sort());
      for (const [selector, min] of seen) expect(min, selector).toBeGreaterThanOrEqual(4.5);
    });
  });
}

test("la barre du navigateur a la couleur du bandeau, quel que soit le thème choisi", async ({ page }) => {
  await page.goto("/#demo");
  const meta = page.locator('meta[name="theme-color"]');
  const band = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--band").trim());
  await expect(meta).toHaveCount(1);
  for (const theme of ["Sombre", "Clair", "Auto"]) {
    await page.getByRole("button", { name: "Plus d'options" }).click();
    await page.getByRole("menuitemradio", { name: theme }).click();
    expect((await meta.getAttribute("content")).toLowerCase()).toBe(band);
    await page.keyboard.press("Escape");
  }
});

test.describe("téléphone", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("le bouton flottant « + » garde un anneau de focus visible sur la page", async ({ page }) => {
    await page.goto("/#demo");
    const add = page.getByRole("button", { name: "Ajouter un élément" });
    await expect(add).toBeVisible();
    // Au clavier, pour que le navigateur affiche l'anneau.
    for (let i = 0; i < 12 && !(await add.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press("Tab");
    const [outline, focus, band] = await add.evaluate((el) => {
      const probe = (v) => {
        const i = document.createElement("i");
        i.style.color = `var(${v})`;
        document.body.append(i);
        const c = getComputedStyle(i).color;
        i.remove();
        return c;
      };
      return [getComputedStyle(el).outlineColor, probe("--focus"), probe("--band-ink")];
    });
    expect(outline).toBe(focus);
    expect(outline).not.toBe(band);
  });
});
