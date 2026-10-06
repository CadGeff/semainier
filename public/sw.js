/* Semainier — service worker.
 * Réseau d'abord, cache en secours : tu as toujours la dernière version en ligne,
 * et l'interface s'ouvre quand même hors connexion. Les appels à Supabase
 * (autre origine) ne passent jamais par ce cache.
 * Pense à incrémenter CACHE quand tu ajoutes ou renommes un fichier de SHELL
 * (le test E2E offline.spec.js échoue si un fichier listé n'existe pas).
 */
const CACHE = "semainier-v14";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "config.js",
  "theme.js",
  "js/account.js",
  "js/app.js",
  "js/back.js",
  "js/backup.js",
  "js/board.js",
  "js/carry.js",
  "js/categories.js",
  "js/conflicts.js",
  "js/detail.js",
  "js/dom.js",
  "js/errors.js",
  "js/form.js",
  "js/ids.js",
  "js/items.js",
  "js/layout.js",
  "js/menu.js",
  "js/month.js",
  "js/recurrence.js",
  "js/redo.js",
  "js/session.js",
  "js/state.js",
  "js/store.js",
  "js/toast.js",
  "js/views.js",
  "vendor/supabase-2.117.2.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "fonts/bodoni-moda-latin-800-normal.woff2",
  "fonts/instrument-sans-latin-400-normal.woff2",
  "fonts/instrument-sans-latin-500-normal.woff2",
  "fonts/instrument-sans-latin-600-normal.woff2",
  "fonts/ibm-plex-mono-latin-400-normal.woff2",
  "fonts/ibm-plex-mono-latin-500-normal.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined)),
      ),
  );
});
