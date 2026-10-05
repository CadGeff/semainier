// Les couleurs de l'identité sont écrites à plusieurs endroits (feuille de style, page,
// manifeste, icône) : ces tests vérifient qu'elles ne divergent pas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../public/${path}`, import.meta.url), "utf8");

const css = read("styles.css");
const html = read("index.html");
const manifest = JSON.parse(read("manifest.webmanifest"));
const icon = read("icons/icon.svg");

/** Valeur d'un jeton dans le premier bloc :root (thème clair). */
function token(name) {
  const root = css.split(":root {")[1].split("\n}")[0];
  const m = root.match(new RegExp(`\\n\\s*--${name}:\\s*([^;]+);`));
  assert.ok(m, `jeton --${name} introuvable`);
  return m[1].trim().toLowerCase();
}

test("bandeau : la barre du navigateur et l'écran de lancement ont sa couleur", () => {
  const band = token("band");
  const metas = [...html.matchAll(/<meta name="theme-color" content="([^"]+)"/g)].map((m) => m[1].toLowerCase());
  assert.deepEqual(metas, [band], "une seule balise theme-color, de la couleur du bandeau");
  assert.equal(manifest.theme_color.toLowerCase(), band);
  assert.equal(manifest.background_color.toLowerCase(), band);
});

test("bandeau : le thème sombre ne redéfinit pas ses couleurs", () => {
  for (const name of ["band", "band-ink", "band-ink-2", "band-edge", "band-margin"]) {
    const count = css.split(`--${name}:`).length - 1;
    assert.equal(count, 1, `--${name} est défini ${count} fois`);
  }
});

test("icône : son fond est le bleu du bandeau, son chiffre le blanc cassé du week-end", () => {
  const fills = [...icon.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
  assert.ok(fills.includes(token("band")), "le fond de l'icône n'est pas la couleur du bandeau");
  assert.ok(fills.includes(token("band-ink")), "le chiffre de l'icône n'est pas la couleur du texte du bandeau");
  assert.equal(token("band-ink"), token("weekend"));
});
