import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listSavedServices,
  saveService,
  deleteService,
  exportSavedServices,
  importSavedServices,
  EXPORT_FORMAT_VERSION,
} from "../asset/js/storage/savedServices.js";
import { DEFAULT_LENGTH } from "../asset/js/crypto/deterministicPassword.js";

// Simule un store async générique (le même genre d'interface que chrome.storage.local),
// pas juste localStorage : garantit que le module ne suppose jamais une lecture/écriture
// synchrone.
function fakeStore() {
  const data = new Map();
  return {
    async getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async setItem(key, value) {
      data.set(key, value);
    },
  };
}

test("saved list is empty by default", async () => {
  assert.deepEqual(await listSavedServices(fakeStore()), []);
});

test("saveService then listSavedServices roundtrips the entry", async () => {
  const store = fakeStore();
  await saveService(
    { service: "GitHub.com", username: "  damien  ", version: 1, length: 24, profile: "alphanumeric" },
    store
  );
  const entries = await listSavedServices(store);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    service: "github.com",
    username: "damien",
    version: "1",
    length: 24,
    profile: "alphanumeric",
  });
});

test("saveService defaults length/profile when missing or invalid", async () => {
  const store = fakeStore();
  await saveService({ service: "github.com", username: "damien", version: 1 }, store);
  const entries = await listSavedServices(store);
  assert.equal(entries[0].length, DEFAULT_LENGTH);
  assert.equal(entries[0].profile, "standard");
});

test("saveService clamps out-of-range length back to the default (UI allows 6-32)", async () => {
  const store = fakeStore();
  await saveService({ service: "toolow.com", username: "damien", version: 1, length: 3 }, store);
  await saveService({ service: "toohigh.com", username: "damien", version: 1, length: 999 }, store);
  const entries = await listSavedServices(store);
  assert.equal(entries.find((e) => e.service === "toolow.com").length, DEFAULT_LENGTH);
  assert.equal(entries.find((e) => e.service === "toohigh.com").length, DEFAULT_LENGTH);
});

test("saveService accepts the new digits profile", async () => {
  const store = fakeStore();
  await saveService({ service: "bank.com", username: "damien", version: 1, length: 8, profile: "digits" }, store);
  const entries = await listSavedServices(store);
  assert.equal(entries[0].profile, "digits");
  assert.equal(entries[0].length, 8);
});

test("saving the same service+username again replaces the entry instead of duplicating", async () => {
  const store = fakeStore();
  await saveService({ service: "github.com", username: "damien", version: 1 }, store);
  await saveService({ service: "github.com", username: "damien", version: 2 }, store);
  const entries = await listSavedServices(store);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].version, "2");
});

test("same service with a different username creates a separate entry", async () => {
  const store = fakeStore();
  await saveService({ service: "github.com", username: "damien", version: 1 }, store);
  await saveService({ service: "github.com", username: "autre", version: 1 }, store);
  assert.equal((await listSavedServices(store)).length, 2);
});

test("deleteService removes only the matching entry", async () => {
  const store = fakeStore();
  await saveService({ service: "github.com", username: "damien", version: 1 }, store);
  await saveService({ service: "steam", username: "damien", version: 1 }, store);
  await deleteService({ service: "github.com", username: "damien" }, store);
  const entries = await listSavedServices(store);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].service, "steam");
});

test("list is sorted by service then username", async () => {
  const store = fakeStore();
  await saveService({ service: "steam", username: "zzz", version: 1 }, store);
  await saveService({ service: "amazon", username: "damien", version: 1 }, store);
  await saveService({ service: "amazon", username: "aaa", version: 1 }, store);
  const entries = await listSavedServices(store);
  assert.deepEqual(
    entries.map((e) => `${e.service}/${e.username}`),
    ["amazon/aaa", "amazon/damien", "steam/zzz"]
  );
});

test("saveService requires a non-empty service", async () => {
  const store = fakeStore();
  await assert.rejects(() => saveService({ service: "   ", username: "damien", version: 1 }, store));
});

test("saveService is missing gracefully tolerated when store has corrupted data", async () => {
  const store = fakeStore();
  await store.setItem("password-crypter:saved-services", "not valid json");
  assert.deepEqual(await listSavedServices(store), []);
  await saveService({ service: "github.com", username: "damien", version: 1 }, store);
  assert.equal((await listSavedServices(store)).length, 1);
});

test("exportSavedServices never leaks a password or the Master Secret (by construction: not in the model)", async () => {
  const store = fakeStore();
  await saveService({ service: "github.com", username: "damien", version: 1, length: 24, profile: "digits" }, store);
  const exported = await exportSavedServices(store);
  assert.equal(exported.version, EXPORT_FORMAT_VERSION);
  assert.equal(exported.type, "password-crypter/saved-services-export");
  assert.ok(typeof exported.exportedAt === "string");
  assert.deepEqual(exported.entries, [
    { service: "github.com", username: "damien", version: "1", length: 24, profile: "digits" },
  ]);
  // Aucune clé autre que celles du modèle (service/username/version/length/profile) :
  // vérifie qu'aucun champ additionnel (mot de passe, secret...) ne s'est glissé dedans.
  for (const entry of exported.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ["length", "profile", "service", "username", "version"]);
  }
});

test("importSavedServices roundtrips through export on a fresh store", async () => {
  const source = fakeStore();
  await saveService({ service: "github.com", username: "damien", version: 1 }, source);
  await saveService({ service: "steam", username: "dam", version: 2, length: 24, profile: "alphanumeric" }, source);
  const exported = await exportSavedServices(source);

  const target = fakeStore();
  const count = await importSavedServices(exported, target);
  assert.equal(count, 2);
  assert.deepEqual(await listSavedServices(target), await listSavedServices(source));
});

test("importSavedServices upserts: an imported entry replaces an existing one with the same service+username", async () => {
  const store = fakeStore();
  await saveService({ service: "github.com", username: "damien", version: 1 }, store);
  await importSavedServices(
    {
      type: "password-crypter/saved-services-export",
      version: EXPORT_FORMAT_VERSION,
      entries: [{ service: "github.com", username: "damien", version: "5", length: 24, profile: "digits" }],
    },
    store
  );
  const entries = await listSavedServices(store);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].version, "5");
  assert.equal(entries[0].profile, "digits");
});

test("importSavedServices rejects a file that isn't a Password Crypter export", async () => {
  const store = fakeStore();
  await assert.rejects(() => importSavedServices({ foo: "bar" }, store));
  await assert.rejects(() => importSavedServices(null, store));
  await assert.rejects(() => importSavedServices("not even an object", store));
});

test("importSavedServices rejects an unsupported export version", async () => {
  const store = fakeStore();
  await assert.rejects(() =>
    importSavedServices(
      { type: "password-crypter/saved-services-export", version: 999, entries: [] },
      store
    )
  );
});

test("importSavedServices skips malformed entries but keeps importing the valid ones", async () => {
  const store = fakeStore();
  const count = await importSavedServices(
    {
      type: "password-crypter/saved-services-export",
      version: EXPORT_FORMAT_VERSION,
      entries: [null, { service: 42 }, {}, { service: "github.com", username: "damien", version: 1 }],
    },
    store
  );
  assert.equal(count, 1);
  assert.equal((await listSavedServices(store)).length, 1);
});
