// Service worker à la racine du site (et non dans asset/js/) : son scope par défaut
// est son propre dossier et en-dessous, donc il doit vivre ici pour couvrir toute l'app,
// y compris quand GitHub Pages sert le projet sous un sous-chemin (/mon-repo/).
//
// Rôle unique : mettre en cache l'app shell pour un fonctionnement hors-ligne. Aucune
// requête réseau vers un tiers, aucune donnée envoyée nulle part — uniquement les
// fichiers statiques de ce même dépôt.

// À incrémenter à chaque changement de fichiers mis en cache, pour forcer la purge
// de l'ancien cache chez les utilisateurs déjà installés.
const CACHE_NAME = "password-crypter-v8";

const PRECACHE_URLS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "asset/style/style.css",
  "asset/js/app.js",
  "asset/js/crypto/base64url.js",
  "asset/js/crypto/errors.js",
  "asset/js/crypto/keyDerivation.js",
  "asset/js/crypto/encryption.js",
  "asset/js/crypto/deterministicPassword.js",
  "asset/js/storage/savedServices.js",
  "asset/icons/icon-192.png",
  "asset/icons/icon-512.png",
  "asset/icons/icon-maskable-512.png",
  "asset/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Cache d'abord (rapide, marche hors-ligne), avec revalidation réseau en arrière-plan
// pour que la prochaine visite récupère une version plus fraîche si le cache a changé.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
