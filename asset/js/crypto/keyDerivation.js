// Le Master Secret ne doit jamais servir directement de clé : on le fait toujours
// passer par PBKDF2-SHA256 avant de l'utiliser en AES-GCM ou en HMAC.

const textEncoder = new TextEncoder();

async function importMasterSecretKey(masterSecret) {
  return crypto.subtle.importKey("raw", textEncoder.encode(masterSecret), "PBKDF2", false, [
    "deriveKey",
  ]);
}

export async function deriveAesGcmKey(masterSecret, salt, iterations) {
  const baseKey = await importMasterSecretKey(masterSecret);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function deriveHmacKey(masterSecret, salt, iterations) {
  const baseKey = await importMasterSecretKey(masterSecret);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"]
  );
}
