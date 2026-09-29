import { test } from "node:test";
import assert from "node:assert/strict";
import { registrableDomain, serviceFromUrl, serviceMatchesUrl } from "../extension/serviceDetection.js";

test("registrableDomain keeps the last two labels by default", () => {
  assert.equal(registrableDomain("github.com"), "github.com");
  assert.equal(registrableDomain("www.github.com"), "github.com");
  assert.equal(registrableDomain("accounts.google.com"), "google.com");
  assert.equal(registrableDomain("Mail.Google.COM."), "google.com");
});

test("registrableDomain handles multi-label suffixes and per-site hosting", () => {
  assert.equal(registrableDomain("www.amazon.co.uk"), "amazon.co.uk");
  assert.equal(registrableDomain("connexion.impots.gouv.fr"), "impots.gouv.fr");
  assert.equal(registrableDomain("alice.github.io"), "alice.github.io");
});

test("registrableDomain leaves IPs and single-label hosts alone", () => {
  assert.equal(registrableDomain("localhost"), "localhost");
  assert.equal(registrableDomain("192.168.1.10"), "192.168.1.10");
});

test("serviceFromUrl only works on http(s) pages", () => {
  assert.equal(serviceFromUrl("https://github.com/login?return_to=x"), "github.com");
  assert.equal(serviceFromUrl("http://localhost:8080/"), "localhost");
  assert.equal(serviceFromUrl("chrome://extensions"), null);
  assert.equal(serviceFromUrl("file:///home/me/index.html"), null);
  assert.equal(serviceFromUrl("pas une url"), null);
});

test("serviceMatchesUrl recognizes domains, subdomains, urls and bare names", () => {
  const url = "https://accounts.google.com/signin";
  assert.equal(serviceMatchesUrl("google.com", url), true);
  assert.equal(serviceMatchesUrl("accounts.google.com", url), true);
  assert.equal(serviceMatchesUrl("mail.google.com", url), true);
  assert.equal(serviceMatchesUrl("https://www.google.com/", url), true);
  assert.equal(serviceMatchesUrl("google", url), true);
  assert.equal(serviceMatchesUrl("  Google.com ", url), true);
});

test("serviceMatchesUrl rejects other sites and lookalikes", () => {
  const url = "https://github.com/login";
  assert.equal(serviceMatchesUrl("gitlab.com", url), false);
  assert.equal(serviceMatchesUrl("hub.com", url), false);
  assert.equal(serviceMatchesUrl("steam", url), false);
  assert.equal(serviceMatchesUrl("github.com", "https://github.com.evil.io/"), false);
  assert.equal(serviceMatchesUrl("alice.github.io", "https://bob.github.io/"), false);
  assert.equal(serviceMatchesUrl("github.com", "chrome://newtab"), false);
  assert.equal(serviceMatchesUrl("", url), false);
});
