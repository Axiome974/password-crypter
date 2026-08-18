// Registre local des services "enregistrés" pour le générateur : uniquement de la
// métadonnée non secrète (service, identifiant, version) — jamais le Master Secret,
// jamais le mot de passe généré. Sans le Master Secret, cette liste ne permet à
// personne de reconstruire un mot de passe ; au pire elle révèle quels comptes existent.
//
// Toutes les fonctions sont async et attendent un `store` avec getItem(key)/setItem(key,
// value) retournant des Promises : ça marche aussi bien avec localStorage (site web, via
// l'adaptateur ci-dessous) qu'avec chrome.storage.local (extension, nativement async) —
// même modèle de données et même logique des deux côtés, seul le backend change.

import {
  normalizeGeneratorInputs,
  DEFAULT_LENGTH,
  MIN_LENGTH,
  MAX_LENGTH,
  PROFILES,
} from "../crypto/deterministicPassword.js";

const STORAGE_KEY = "password-crypter:saved-services";
// v2 ajoute length/profile : sans eux, recalculer le mot de passe depuis cette liste
// donnerait un résultat différent de celui réellement utilisé si un profil ou une
// longueur non standard avait été choisi. Le changement de version invalide proprement
// les entrées v1 existantes (readAll() les ignore) plutôt que de les lire à moitié.
const SCHEMA_VERSION = 2;

// Adaptateur par défaut pour le site web : localStorage est synchrone, on l'enveloppe
// dans des fonctions async pour respecter l'interface commune du store.
const localStorageAdapter = {
  async getItem(key) {
    return globalThis.localStorage.getItem(key);
  },
  async setItem(key, value) {
    globalThis.localStorage.setItem(key, value);
  },
};

function entryKey(service, username) {
  return `${service} ${username}`;
}

async function readAll(store) {
  try {
    const raw = await store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!data || data.version !== SCHEMA_VERSION || !Array.isArray(data.entries)) return [];
    return data.entries;
  } catch {
    return [];
  }
}

async function writeAll(store, entries) {
  await store.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, entries }));
}

export async function listSavedServices(store = localStorageAdapter) {
  const entries = await readAll(store);
  return entries
    .slice()
    .sort((a, b) => a.service.localeCompare(b.service) || a.username.localeCompare(b.username));
}

// Clé par service+identifiant : ré-enregistrer avec une version différente remplace
// l'entrée existante plutôt que d'empiler des doublons. La liste reste "ma recette
// actuelle par compte", pas un historique.
//
// length/profile sont enregistrés avec le reste : ce sont eux qui garantissent que
// recalculer depuis cette liste redonne EXACTEMENT le mot de passe déjà utilisé sur
// le site, même si un profil ou une longueur non standard avait été choisi.
export async function saveService({ service, username, version, length, profile }, store = localStorageAdapter) {
  const normalized = normalizeGeneratorInputs({ service, username, version });
  if (!normalized.service) throw new Error("Le service est requis pour enregistrer.");

  const validLength =
    Number.isInteger(length) && length >= MIN_LENGTH && length <= MAX_LENGTH ? length : DEFAULT_LENGTH;
  const validProfile = profile in PROFILES ? profile : "standard";

  const entry = { ...normalized, length: validLength, profile: validProfile };
  const key = entryKey(normalized.service, normalized.username);
  const entries = (await readAll(store)).filter((e) => entryKey(e.service, e.username) !== key);
  entries.push(entry);
  await writeAll(store, entries);
  return entry;
}

export async function deleteService({ service, username }, store = localStorageAdapter) {
  const key = entryKey(service, username);
  const entries = (await readAll(store)).filter((entry) => entryKey(entry.service, entry.username) !== key);
  await writeAll(store, entries);
}

// Format d'export versionné séparément du SCHEMA_VERSION du stockage interne : un
// fichier exporté doit rester lisible même si le format de stockage local change un
// jour. Ne contient jamais le Master Secret ni un mot de passe généré — uniquement
// la "recette" (service/identifiant/version/longueur/profil), comme le stockage
// lui-même.
export const EXPORT_FORMAT_VERSION = 1;
const EXPORT_TYPE = "password-crypter/saved-services-export";

export async function exportSavedServices(store = localStorageAdapter) {
  return {
    type: EXPORT_TYPE,
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    entries: await listSavedServices(store),
  };
}

// Réutilise saveService() pour chaque entrée importée : la même normalisation et les
// mêmes bornes (longueur, profil) s'appliquent, qu'une entrée vienne d'une saisie
// manuelle ou d'un fichier importé. Une entrée importée qui partage service+identifiant
// avec une entrée déjà présente la remplace (le fichier importé fait foi), exactement
// comme un ré-enregistrement manuel.
export async function importSavedServices(data, store = localStorageAdapter) {
  if (!data || typeof data !== "object") {
    throw new Error("Fichier d'import invalide.");
  }
  if (data.type !== EXPORT_TYPE) {
    throw new Error("Ce fichier ne ressemble pas à un export Password Crypter.");
  }
  if (data.version !== EXPORT_FORMAT_VERSION) {
    throw new Error(`Version d'export non prise en charge (${data.version}).`);
  }
  if (!Array.isArray(data.entries)) {
    throw new Error("Fichier d'import invalide.");
  }

  let imported = 0;
  for (const entry of data.entries) {
    if (!entry || typeof entry.service !== "string") continue;
    await saveService(
      {
        service: entry.service,
        username: typeof entry.username === "string" ? entry.username : "",
        version: entry.version ?? 1,
        length: entry.length,
        profile: entry.profile,
      },
      store
    );
    imported++;
  }
  return imported;
}
