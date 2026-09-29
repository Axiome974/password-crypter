import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Faux chrome.storage / chrome.alarms minimal, installé avant l'import du module.
const areas = { local: new Map(), session: new Map() };
const alarms = new Map();
function fakeArea(map) {
  return {
    async get(key) {
      return map.has(key) ? { [key]: structuredClone(map.get(key)) } : {};
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) map.set(k, structuredClone(v));
    },
    async remove(key) {
      map.delete(key);
    },
  };
}
globalThis.chrome = {
  storage: { local: fakeArea(areas.local), session: fakeArea(areas.session) },
  alarms: {
    async create(name, info) {
      alarms.set(name, info);
    },
    async clear(name) {
      alarms.delete(name);
    },
  },
};

const {
  rememberGeneratorKey,
  loadRememberedGeneratorKey,
  forgetGeneratorKey,
  loadRememberMinutes,
  saveRememberMinutes,
  SESSION_KEY,
  LOCK_ALARM,
} = await import("../extension/masterSession.js");
const { deriveGeneratorKeyBytes, importGeneratorKey, generateV1, generateV1WithKey } = await import(
  "../asset/js/crypto/deterministicPassword.js"
);

beforeEach(() => {
  areas.local.clear();
  areas.session.clear();
  alarms.clear();
});

test("remember preference defaults to 0 and rejects unknown durations", async () => {
  assert.equal(await loadRememberMinutes(), 0);
  await saveRememberMinutes(15);
  assert.equal(await loadRememberMinutes(), 15);
  await saveRememberMinutes(42);
  assert.equal(await loadRememberMinutes(), 0);
});

test("a remembered key regenerates the exact same passwords, never storing the master secret", async () => {
  const keyBytes = await deriveGeneratorKeyBytes("master secret");
  const { expiresAt, durationMs } = await rememberGeneratorKey(keyBytes, 60);
  assert.equal(durationMs, 60 * 60_000);

  assert.ok(!JSON.stringify([...areas.session.values()]).includes("master secret"));
  assert.equal(alarms.get(LOCK_ALARM).when, expiresAt);

  const remembered = await loadRememberedGeneratorKey();
  assert.deepEqual(remembered.keyBytes, keyBytes);
  assert.equal(remembered.durationMs, durationMs);
  const entry = { service: "github.com", username: "damien", version: 1 };
  assert.equal(
    await generateV1WithKey(await importGeneratorKey(remembered.keyBytes), entry),
    await generateV1("master secret", entry)
  );
});

test("an expired key is forgotten on read", async () => {
  await rememberGeneratorKey(new Uint8Array(32), 5);
  const stored = areas.session.get(SESSION_KEY);
  areas.session.set(SESSION_KEY, { ...stored, expiresAt: Date.now() - 1 });

  assert.equal(await loadRememberedGeneratorKey(), null);
  assert.equal(areas.session.has(SESSION_KEY), false);
  assert.equal(alarms.has(LOCK_ALARM), false);
});

test("forgetGeneratorKey clears the key and the lock alarm", async () => {
  await rememberGeneratorKey(new Uint8Array(32), 5);
  await forgetGeneratorKey();
  assert.equal(await loadRememberedGeneratorKey(), null);
  assert.equal(alarms.has(LOCK_ALARM), false);
});
