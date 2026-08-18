import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptV2, decryptV2 } from "../asset/js/crypto/encryption.js";

test("decrypt(encrypt(x, key), key) === x", async () => {
  const blob = await encryptV2("correct horse", "bonjour");
  assert.equal(await decryptV2("correct horse", blob), "bonjour");
});

test("roundtrip preserves unicode, symbols and empty-ish edge content", async () => {
  const cases = ["", "é è @ # ' \" \\ ` café", "a".repeat(5000), "🔐🚀"];
  for (const plaintext of cases) {
    const blob = await encryptV2("clé de test", plaintext);
    assert.equal(await decryptV2("clé de test", blob), plaintext);
  }
});

test("wrong master secret fails to decrypt", async () => {
  const blob = await encryptV2("bonne cle", "secret");
  await assert.rejects(() => decryptV2("mauvaise cle", blob), { code: "DECRYPTION_FAILED" });
});

test("tampered ciphertext fails to decrypt", async () => {
  const blob = await encryptV2("cle", "message important");
  const payload = JSON.parse(Buffer.from(blob.slice(4), "base64url").toString("utf8"));
  payload.ct = payload.ct.slice(0, -2) + (payload.ct.at(-2) === "A" ? "B" : "A") + payload.ct.at(-1);
  const tampered = "PC2." + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  await assert.rejects(() => decryptV2("cle", tampered), { code: "DECRYPTION_FAILED" });
});

test("two encryptions of the same plaintext produce different blobs, both decryptable", async () => {
  const a = await encryptV2("cle", "bonjour");
  const b = await encryptV2("cle", "bonjour");
  assert.notEqual(a, b);
  assert.equal(await decryptV2("cle", a), "bonjour");
  assert.equal(await decryptV2("cle", b), "bonjour");
});

test("unrecognized blob format is rejected with a clear error", async () => {
  await assert.rejects(() => decryptV2("cle", "not-a-real-blob"), {
    code: "UNRECOGNIZED_FORMAT",
  });
  await assert.rejects(() => decryptV2("cle", "PC2.not-valid-base64url-json!!!"), {
    code: "UNRECOGNIZED_FORMAT",
  });
});

test("unknown blob version is rejected explicitly", async () => {
  const payload = { v: 99, kdf: "PBKDF2-SHA256", iter: 1, salt: "AA", iv: "AA", ct: "AA" };
  const blob = "PC2." + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  await assert.rejects(() => decryptV2("cle", blob), { code: "UNSUPPORTED_VERSION" });
});
