// Générateur déterministe "generator/v1" : à Master Secret + service + identifiant + version
// identiques, produit toujours exactement le même mot de passe. Aucun aléa nulle part (le
// salt PBKDF2 est fixe, dérivé du namespace lui-même, pas de crypto.getRandomValues ici).
//
// Cet algorithme est figé pour toujours sous ce nom. Le faire évoluer un jour = créer
// generator/v2 à côté, jamais modifier celui-ci (une refacto ne doit jamais changer un
// mot de passe déjà généré par v1).

import { deriveHmacKey, deriveHmacKeyBytes, importHmacKey } from "./keyDerivation.js";

const NAMESPACE = "password-crypter/generator/v1";
const ITERATIONS = 200000;

const textEncoder = new TextEncoder();
const NAMESPACE_SALT = textEncoder.encode(NAMESPACE);

export const PROFILES = {
  standard: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*_-+=",
  alphanumeric: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  // Exclut 0/O/o, 1/l/I : rien qui se confonde à l'oeil pour une saisie manuelle.
  unambiguous: "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  // Pour les sites (souvent bancaires) qui n'acceptent qu'un code numérique.
  digits: "0123456789",
};

export const DEFAULT_LENGTH = 20;
// Bornes imposées par l'interface (voir app.js) pour coller aux contraintes réelles
// des sites, pas une limite du calcul crypto lui-même : generateV1() reste générique
// et accepte n'importe quelle longueur positive (utile pour les tests de couverture
// d'alphabet, qui utilisent volontairement des longueurs bien au-delà de 32).
export const MIN_LENGTH = 6;
export const MAX_LENGTH = 32;

// Centralise toute la normalisation : un même service/identifiant doit redonner le même
// mot de passe dans plusieurs années, donc rien d'implicite ou d'ambigu ici.
export function normalizeGeneratorInputs({ service, username, version }) {
  return {
    service: service.trim().toLowerCase(),
    username: username.trim(),
    version: String(Math.trunc(Number(version))),
  };
}

async function* hmacKeystreamBlocks(hmacKey, message) {
  let counter = 0;
  while (true) {
    const block = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      textEncoder.encode(`${message}#${counter}`)
    );
    yield new Uint8Array(block);
    counter++;
  }
}

// Convertit un flux d'octets pseudo-aléatoires en chaîne sur `alphabet`, sans biais :
// rejette les octets au-delà du plus grand multiple de la taille de l'alphabet avant
// de faire le modulo, plutôt qu'un simple `byte % alphabet.length`.
async function mapKeystreamToAlphabet(hmacKey, message, alphabet, length) {
  const alphabetSize = alphabet.length;
  const acceptBelow = Math.floor(256 / alphabetSize) * alphabetSize;
  let result = "";

  for await (const block of hmacKeystreamBlocks(hmacKey, message)) {
    for (const byte of block) {
      if (byte >= acceptBelow) continue;
      result += alphabet[byte % alphabetSize];
      if (result.length === length) return result;
    }
  }
  return result; // inatteignable en pratique : la boucle ci-dessus retourne toujours avant
}

// Le sel étant fixe, la clé HMAC ne dépend que du Master Secret : on peut la dériver
// une fois (PBKDF2, lent) puis la réutiliser pour tous les services. C'est ce qui permet
// à l'extension de la mémoriser un temps limité sans jamais garder le Master Secret
// lui-même (voir extension/masterSession.js). Octets bruts : à manipuler comme un secret.
export async function deriveGeneratorKeyBytes(masterSecret) {
  return deriveHmacKeyBytes(masterSecret, NAMESPACE_SALT, ITERATIONS);
}

export async function importGeneratorKey(keyBytes) {
  return importHmacKey(keyBytes);
}

export async function generateV1(masterSecret, entry) {
  const hmacKey = await deriveHmacKey(masterSecret, NAMESPACE_SALT, ITERATIONS);
  return generateV1WithKey(hmacKey, entry);
}

// Même algorithme que generateV1(), à partir d'une clé déjà dérivée (deriveGeneratorKeyBytes
// + importGeneratorKey) : évite de repayer PBKDF2 à chaque service.
export async function generateV1WithKey(
  hmacKey,
  { service, username, version, length = DEFAULT_LENGTH, profile = "standard" }
) {
  const alphabet = PROFILES[profile];
  if (!alphabet) throw new Error(`Profil de générateur inconnu : ${profile}`);
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error(`Longueur de mot de passe invalide : ${length}`);
  }

  const normalized = normalizeGeneratorInputs({ service, username, version });
  const message = JSON.stringify([
    NAMESPACE,
    normalized.service,
    normalized.username,
    normalized.version,
  ]);

  return mapKeystreamToAlphabet(hmacKey, message, alphabet, length);
}
