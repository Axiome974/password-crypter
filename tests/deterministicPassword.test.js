import { test } from "node:test";
import assert from "node:assert/strict";
import { generateV1, PROFILES } from "../asset/js/crypto/deterministicPassword.js";

const base = { service: "github.com", username: "damien", version: 1 };

test("same inputs always produce the same password", async () => {
  const a = await generateV1("master secret", base);
  const b = await generateV1("master secret", base);
  const c = await generateV1("master secret", base);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("changing only the service changes the result", async () => {
  const steam = await generateV1("master secret", { ...base, service: "steam" });
  const github = await generateV1("master secret", { ...base, service: "github.com" });
  assert.notEqual(steam, github);
});

test("changing only the username changes the result", async () => {
  const a = await generateV1("master secret", { ...base, username: "damien" });
  const b = await generateV1("master secret", { ...base, username: "damien2" });
  assert.notEqual(a, b);
});

test("changing only the version changes the result", async () => {
  const v1 = await generateV1("master secret", { ...base, version: 1 });
  const v2 = await generateV1("master secret", { ...base, version: 2 });
  assert.notEqual(v1, v2);
});

test("changing only the master secret changes the result", async () => {
  const a = await generateV1("master secret A", base);
  const b = await generateV1("master secret B", base);
  assert.notEqual(a, b);
});

test("service normalization: case and surrounding whitespace don't matter", async () => {
  const a = await generateV1("master secret", { ...base, service: "GitHub.com" });
  const b = await generateV1("master secret", { ...base, service: "  github.com  " });
  const c = await generateV1("master secret", { ...base, service: "github.com" });
  assert.equal(a, c);
  assert.equal(b, c);
});

test("username normalization trims whitespace but keeps case", async () => {
  const a = await generateV1("master secret", { ...base, username: "  Damien  " });
  const b = await generateV1("master secret", { ...base, username: "Damien" });
  const c = await generateV1("master secret", { ...base, username: "damien" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("respects requested length", async () => {
  for (const length of [16, 20, 24, 32]) {
    const pwd = await generateV1("master secret", { ...base, length });
    assert.equal(pwd.length, length);
  }
});

test("each profile only uses characters from its own alphabet", async () => {
  for (const [profile, alphabet] of Object.entries(PROFILES)) {
    const pwd = await generateV1("master secret", { ...base, profile, length: 64 });
    for (const char of pwd) {
      assert.ok(alphabet.includes(char), `"${char}" not in ${profile} alphabet`);
    }
  }
});

test("digits profile only produces digits (e.g. for banks restricted to numeric codes)", async () => {
  const pwd = await generateV1("master secret", { ...base, profile: "digits", length: 50 });
  assert.match(pwd, /^[0-9]+$/);
});

test("unambiguous profile never contains visually confusable characters", async () => {
  const pwd = await generateV1("master secret", { ...base, profile: "unambiguous", length: 200 });
  for (const bad of ["0", "O", "o", "1", "l", "I"]) {
    assert.ok(!pwd.includes(bad), `unexpected "${bad}" in unambiguous password`);
  }
});

// Vecteur de test figé : garantit qu'une future refacto ne change jamais silencieusement
// les mots de passe déjà générés par generator/v1. Si ce test doit un jour être modifié,
// c'est le signe qu'il fallait créer generator/v2 à la place.
test("generator/v1 fixed test vector", async () => {
  const password = await generateV1("correct horse battery staple", {
    service: "example.com",
    username: "test@example.com",
    version: 1,
    length: 20,
    profile: "standard",
  });
  assert.equal(password, "=Yd*c4VzUCOKu^kExceC");
});
