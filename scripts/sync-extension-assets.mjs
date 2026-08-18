// Copie asset/js/crypto, asset/js/storage et asset/style/style.css dans extension/asset/.
//
// Pourquoi une copie et pas un lien symbolique (ce qu'on avait fait au départ) :
// Chrome ne suit pas le lien symbolique quand il sert les fichiers d'une extension
// "non empaquetée" — le popup se retrouvait sans CSS ni JS, silencieusement (aucune
// erreur visible, juste du HTML brut sans style). Une vraie copie, régénérée par ce
// script, est plus verbeuse mais fonctionne partout, sur tous les OS et navigateurs.
//
// À relancer après toute modification de asset/js/crypto/, asset/js/storage/ ou
// asset/style/style.css, avant de recharger l'extension dans le navigateur.
//
// Usage : node scripts/sync-extension-assets.mjs

import { cpSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

const targets = [
  { from: path.join(repoRoot, "asset", "js", "crypto"), to: path.join(repoRoot, "extension", "asset", "js", "crypto") },
  { from: path.join(repoRoot, "asset", "js", "storage"), to: path.join(repoRoot, "extension", "asset", "js", "storage") },
  {
    from: path.join(repoRoot, "asset", "style", "style.css"),
    to: path.join(repoRoot, "extension", "asset", "style", "style.css"),
  },
];

console.log("Synchronisation des fichiers partagés vers extension/asset/...");
for (const { from, to } of targets) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`  ${path.relative(repoRoot, from)} -> ${path.relative(repoRoot, to)}`);
}
console.log("Terminé.");
