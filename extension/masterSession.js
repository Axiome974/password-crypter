// "Se souvenir pendant…" : on ne mémorise JAMAIS le Master Secret, seulement la clé
// HMAC du générateur déjà dérivée (voir deriveGeneratorKeyBytes). Si elle fuitait, elle
// permettrait de recalculer les mots de passe du générateur, mais pas de retrouver le
// Master Secret (PBKDF2 est à sens unique) ni de déchiffrer les secrets `PC2.`.
//
// chrome.storage.session : en mémoire uniquement (jamais écrit sur disque), vidé à la
// fermeture du navigateur, et inaccessible aux content scripts par défaut. Il ne prend
// que du JSON, d'où les octets en base64url.
//
// Expiration absolue (pas glissante) : `expiresAt` est vérifié à chaque lecture, et une
// alarme demande au service worker (background.js) d'effacer la clé à l'échéance même
// si le popup n'est jamais rouvert.

import { bytesToBase64Url, base64UrlToBytes } from "./asset/js/crypto/base64url.js";

export const SESSION_KEY = "password-crypter:generator-key";
export const LOCK_ALARM = "password-crypter:lock";
const REMEMBER_PREF_KEY = "password-crypter:remember-minutes";

// 0 = ne rien mémoriser (défaut).
export const REMEMBER_OPTIONS = [0, 5, 15, 60];

export async function loadRememberMinutes() {
  const result = await chrome.storage.local.get(REMEMBER_PREF_KEY);
  const minutes = result[REMEMBER_PREF_KEY];
  return REMEMBER_OPTIONS.includes(minutes) ? minutes : 0;
}

export async function saveRememberMinutes(minutes) {
  await chrome.storage.local.set({ [REMEMBER_PREF_KEY]: minutes });
}

// durationMs est gardé pour que le popup puisse afficher la part de temps restante.
export async function rememberGeneratorKey(keyBytes, minutes) {
  const durationMs = minutes * 60_000;
  const expiresAt = Date.now() + durationMs;
  await chrome.storage.session.set({ [SESSION_KEY]: { key: bytesToBase64Url(keyBytes), expiresAt, durationMs } });
  await chrome.alarms.create(LOCK_ALARM, { when: expiresAt });
  return { expiresAt, durationMs };
}

// { keyBytes, expiresAt, durationMs } si une clé valide est mémorisée, sinon null.
export async function loadRememberedGeneratorKey() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  const stored = result[SESSION_KEY];
  if (!stored) return null;
  if (typeof stored.expiresAt !== "number" || Date.now() >= stored.expiresAt) {
    await forgetGeneratorKey();
    return null;
  }
  try {
    const durationMs = typeof stored.durationMs === "number" ? stored.durationMs : stored.expiresAt - Date.now();
    return { keyBytes: base64UrlToBytes(stored.key), expiresAt: stored.expiresAt, durationMs };
  } catch {
    await forgetGeneratorKey();
    return null;
  }
}

export async function forgetGeneratorKey() {
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.alarms.clear(LOCK_ALARM);
}
