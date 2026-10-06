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
