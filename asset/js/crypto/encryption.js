// Format "secret" v2 : PBKDF2-SHA256 (dérivation) + AES-256-GCM (chiffrement authentifié).
// Blob final : "PC2." + base64url(JSON{v, kdf, iter, salt, iv, ct}).
// Le salt et l'IV sont aléatoires à chaque appel -> deux chiffrements du même texte
// avec la même clé produisent toujours deux blobs différents (non déterministe, volontairement).

import { deriveAesGcmKey } from "./keyDerivation.js";
import { bytesToBase64Url, base64UrlToBytes } from "./base64url.js";
import {
  unrecognizedFormatError,
  unsupportedVersionError,
  decryptionFailedError,
  PasswordCrypterError,
} from "./errors.js";

const PREFIX = "PC2.";
const KDF = "PBKDF2-SHA256";
const ITERATIONS = 600000;
// Liée à la version du protocole en additional authenticated data : un blob "PC2"
// falsifié pour se faire passer pour une autre version échouerait à l'authentification.
const AAD = new TextEncoder().encode("password-crypter/secret/v2");

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function encryptV2(masterSecret, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesGcmKey(masterSecret, salt, ITERATIONS);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD },
    key,
    textEncoder.encode(plaintext)
  );

  const payload = {
    v: 2,
    kdf: KDF,
    iter: ITERATIONS,
    salt: bytesToBase64Url(salt),
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(ciphertext)),
  };

  return PREFIX + bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
}

export async function decryptV2(masterSecret, blob) {
  if (typeof blob !== "string" || !blob.startsWith(PREFIX)) {
    throw unrecognizedFormatError();
  }

  let payload;
  try {
    const json = textDecoder.decode(base64UrlToBytes(blob.slice(PREFIX.length)));
    payload = JSON.parse(json);
  } catch {
    throw unrecognizedFormatError();
  }

  if (payload.v !== 2) {
    throw unsupportedVersionError(payload.v);
  }

  try {
    const salt = base64UrlToBytes(payload.salt);
    const iv = base64UrlToBytes(payload.iv);
    const ciphertext = base64UrlToBytes(payload.ct);
    const key = await deriveAesGcmKey(masterSecret, salt, payload.iter);
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: AAD },
      key,
      ciphertext
    );
    return textDecoder.decode(plaintextBuffer);
  } catch (err) {
    if (err instanceof PasswordCrypterError) throw err;
    // Mauvaise clé, tag GCM invalide, données tronquées... jamais l'erreur WebCrypto brute.
    throw decryptionFailedError();
  }
}
