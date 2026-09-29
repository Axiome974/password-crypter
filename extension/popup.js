"use strict";

import {
  generateV1WithKey,
  deriveGeneratorKeyBytes,
  importGeneratorKey,
  MIN_LENGTH,
  MAX_LENGTH,
} from "./asset/js/crypto/deterministicPassword.js";
import {
  listSavedServices,
  saveService,
  deleteService,
  exportSavedServices,
  importSavedServices,
} from "./asset/js/storage/savedServices.js";
import { chromeStorageAdapter } from "./storageAdapter.js";
import {
  loadRememberMinutes,
  saveRememberMinutes,
  rememberGeneratorKey,
  loadRememberedGeneratorKey,
  forgetGeneratorKey,
} from "./masterSession.js";
import { serviceFromUrl, serviceMatchesUrl } from "./serviceDetection.js";

const masterSecretInput = document.getElementById("master-secret");
const toggleMasterSecretBtn = document.getElementById("toggle-master-secret");
const toggleSavedPasswordsBtn = document.getElementById("toggle-saved-passwords");
const savedSearchFieldEl = document.getElementById("saved-search-field");
const savedSearchInput = document.getElementById("saved-search");
const savedListEl = document.getElementById("saved-list");
const savedEmptyEl = document.getElementById("saved-empty");
const savedNoMatchEl = document.getElementById("saved-no-match");
const savedMessageEl = document.getElementById("saved-message");

// service+identifiant -> mot de passe recalculé pour la durée de vie du popup.
// Jamais persisté : recalculé à chaque fois que le popup est rouvert, ou que le
// Master Secret change tant que le popup est ouvert.
const computedPasswords = new Map();
let savedPasswordsRevealed = false;
let savedFilterQuery = "";

const SEARCH_VISIBLE_THRESHOLD = 8;

function setMessage(el, text, type) {
  el.textContent = text;
  el.classList.remove("error", "success");
  if (type) el.classList.add(type);
}

// --- Clé du générateur : dérivée du Master Secret tapé, ou relue depuis la session ---
// mémorisée ("Se souvenir pendant…", voir masterSession.js). Le Master Secret tapé est
// toujours prioritaire sur une clé mémorisée.

const rememberTrigger = document.getElementById("remember-trigger");
const rememberTriggerLabel = document.getElementById("remember-trigger-label");
const rememberMenu = document.getElementById("remember-menu");
const rememberItems = Array.from(rememberMenu.querySelectorAll('[role="menuitemradio"]'));
const rememberProgressEl = document.getElementById("remember-progress");
const rememberTrackEl = document.getElementById("remember-track");
const rememberFillEl = document.getElementById("remember-fill");
const lockBtn = document.getElementById("lock-btn");
const masterHintEl = document.getElementById("master-hint");
const MASTER_PLACEHOLDER_DEFAULT = masterSecretInput.placeholder;

// Dernière minute : la barre change de couleur pour prévenir.
const ENDING_THRESHOLD_MS = 60_000;

let rememberMinutes = 0;
// Dérivation du Master Secret actuellement tapé (PBKDF2 est lent : on ne la refait que
// s'il change). Uniquement en mémoire, pour la durée de vie du popup.
let typedDerivation = null; // { secret, keyBytes, key }
// Clé mémorisée dans chrome.storage.session, si elle existe et n'a pas expiré.
let sessionDerivation = null; // { key, expiresAt, durationMs }

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function hasSessionKey() {
  return sessionDerivation !== null && Date.now() < sessionDerivation.expiresAt;
}

function hasGeneratorKey() {
  return Boolean(masterSecretInput.value) || hasSessionKey();
}

// Barre de temps restant. Rafraîchie chaque seconde avec une transition CSS d'1 s
// linéaire vers la valeur de la seconde suivante : la barre fond en continu, sans
// saut, et se recale d'elle-même (ex. après une mise en veille).
function renderRememberProgress({ instant = false } = {}) {
  const remaining = sessionDerivation.expiresAt - Date.now();
  const ratio = Math.max(0, Math.min(1, (remaining - 1000) / sessionDerivation.durationMs));

  if (instant) {
    rememberFillEl.style.transition = "none";
    rememberFillEl.style.transform = `scaleX(${ratio})`;
    void rememberFillEl.offsetWidth; // applique la valeur avant de réactiver la transition
    rememberFillEl.style.transition = "";
  } else {
    rememberFillEl.style.transform = `scaleX(${ratio})`;
  }

  const label = `Verrouillage automatique à ${formatClock(sessionDerivation.expiresAt)}`;
  rememberTrackEl.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  rememberTrackEl.setAttribute("aria-valuetext", label);
  rememberTrackEl.title = label;
  rememberTrackEl.classList.toggle("ending", remaining <= ENDING_THRESHOLD_MS);
}

function renderRememberState() {
  const active = hasSessionKey();
  const wasHidden = rememberProgressEl.hidden;
  rememberProgressEl.hidden = !active;
  masterHintEl.hidden = active;
  masterSecretInput.placeholder = active
    ? `Mémorisé · ${formatClock(sessionDerivation.expiresAt)}`
    : MASTER_PLACEHOLDER_DEFAULT;
  // Pas d'animation depuis "plein" quand la barre apparaît (ex. popup rouvert à mi-parcours).
  if (active) renderRememberProgress({ instant: wasHidden });
}

function renderRememberMenu() {
  const selected = rememberItems.find((item) => Number(item.dataset.minutes) === rememberMinutes);
  for (const item of rememberItems) item.setAttribute("aria-checked", String(item === selected));
  rememberTriggerLabel.textContent = rememberMinutes > 0 ? selected.textContent : "";
  rememberTrigger.classList.toggle("active", rememberMinutes > 0);
  const description = rememberMinutes > 0 ? `Se souvenir : ${selected.textContent}` : "Se souvenir : non";
  rememberTrigger.setAttribute("aria-label", description);
  rememberTrigger.title = description;
}

async function deriveTypedSecret(secret) {
  if (typedDerivation?.secret !== secret) {
    const keyBytes = await deriveGeneratorKeyBytes(secret);
    typedDerivation = { secret, keyBytes, key: await importGeneratorKey(keyBytes) };
  }
  return typedDerivation;
}

async function rememberTypedDerivation(derivation) {
  const { expiresAt, durationMs } = await rememberGeneratorKey(derivation.keyBytes, rememberMinutes);
  sessionDerivation = { key: derivation.key, expiresAt, durationMs };
  renderRememberState();
}

// CryptoKey HMAC à utiliser, ou null s'il n'y a ni Master Secret tapé ni clé mémorisée.
async function resolveGeneratorKey() {
  const secret = masterSecretInput.value;
  if (secret) {
    const derivation = await deriveTypedSecret(secret);
    if (rememberMinutes > 0 && sessionDerivation?.key !== derivation.key) {
      await rememberTypedDerivation(derivation);
    }
    return derivation.key;
  }
  if (hasSessionKey()) return sessionDerivation.key;
  if (sessionDerivation) lock();
  return null;
}

async function requireGeneratorKey(messageEl) {
  const key = await resolveGeneratorKey();
  if (!key) setMessage(messageEl, "Renseigne un Master Secret.", "error");
  return key;
}

async function lock() {
  sessionDerivation = null;
  typedDerivation = null;
  masterSecretInput.value = "";
  computedPasswords.clear();
  await forgetGeneratorKey();
  renderRememberState();
  renderSavedList();
}

async function loadSession() {
  const remembered = await loadRememberedGeneratorKey();
  sessionDerivation = remembered
    ? {
        key: await importGeneratorKey(remembered.keyBytes),
        expiresAt: remembered.expiresAt,
        durationMs: remembered.durationMs,
      }
    : null;
  renderRememberState();
}

async function setRememberMinutes(minutes) {
  rememberMinutes = minutes;
  renderRememberMenu();
  await saveRememberMinutes(rememberMinutes);
  if (rememberMinutes === 0) {
    // "Non" veut dire non tout de suite : on oublie aussi une clé déjà mémorisée,
    // sans effacer le Master Secret éventuellement en cours de saisie.
    sessionDerivation = null;
    await forgetGeneratorKey();
    renderRememberState();
  } else if (masterSecretInput.value) {
    await rememberTypedDerivation(await deriveTypedSecret(masterSecretInput.value));
  } else if (sessionDerivation) {
    // Nouvelle durée pour la clé déjà mémorisée : il faut repartir des octets. La barre
    // repart pleine, sans animation.
    const remembered = await loadRememberedGeneratorKey();
    if (remembered) {
      Object.assign(sessionDerivation, await rememberGeneratorKey(remembered.keyBytes, rememberMinutes));
      rememberProgressEl.hidden = true;
    }
    renderRememberState();
  }
}

// --- Menu horloge (dans le champ Master Secret) ---

function openRememberMenu() {
  rememberMenu.hidden = false;
  rememberTrigger.setAttribute("aria-expanded", "true");
  (rememberItems.find((item) => item.getAttribute("aria-checked") === "true") ?? rememberItems[0]).focus();
  document.addEventListener("pointerdown", closeRememberMenuOnOutsideClick);
}

function closeRememberMenu({ focusTrigger = false } = {}) {
  if (rememberMenu.hidden) return;
  rememberMenu.hidden = true;
  rememberTrigger.setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", closeRememberMenuOnOutsideClick);
  if (focusTrigger) rememberTrigger.focus();
}

function closeRememberMenuOnOutsideClick(event) {
  if (!rememberMenu.contains(event.target) && !rememberTrigger.contains(event.target)) closeRememberMenu();
}

rememberTrigger.addEventListener("click", () => {
  if (rememberMenu.hidden) openRememberMenu();
  else closeRememberMenu();
});

rememberMenu.addEventListener("keydown", (event) => {
  const index = rememberItems.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    rememberItems[(index + step + rememberItems.length) % rememberItems.length].focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeRememberMenu({ focusTrigger: true });
  } else if (event.key === "Tab") {
    closeRememberMenu();
  }
});

for (const item of rememberItems) {
  item.addEventListener("click", () => {
    closeRememberMenu({ focusTrigger: true });
    setRememberMinutes(Number(item.dataset.minutes));
  });
}

lockBtn.addEventListener("click", () => {
  lock();
  masterSecretInput.focus();
});

// Fait fondre la barre, et verrouille à l'échéance si le popup est resté ouvert.
window.setInterval(() => {
  if (!sessionDerivation) return;
  if (hasSessionKey()) renderRememberProgress();
  else lock();
}, 1000);

// --- Onglet actif : service détecté depuis son URL ---
// La permission activeTab (accordée par le clic sur l'icône de l'extension) suffit à
// lire l'URL de l'onglet courant ; pas besoin de la permission "tabs".

let activeTabUrl = null;

async function loadActiveTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabUrl = tab?.url ?? null;
  } catch {
    activeTabUrl = null;
  }
}

// Bornes UI (voir deterministicPassword.js) : le calcul crypto lui-même accepte
// n'importe quelle longueur positive, cette limite 6-32 colle juste aux contraintes
// réelles des sites (ex. certaines banques imposent 8 caractères).
function readValidLength(messageEl) {
  const length = Number(genLengthInput.value);
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    setMessage(messageEl, `La longueur doit être un nombre entier entre ${MIN_LENGTH} et ${MAX_LENGTH}.`, "error");
    return null;
  }
  return length;
}

async function withBusyButton(button, task) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Calcul en cours…";
  try {
    await task();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function savedEntryKey(entry) {
  return `${entry.service} ${entry.username}`;
}

function maskPassword(password) {
  return "•".repeat(password.length);
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.style.position = "fixed";
    temp.style.opacity = "0";
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
  }
}

function svgIcon(pathsHtml) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = pathsHtml;
  return svg;
}

const deleteIconSvg = () => svgIcon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');

const copyIconSvg = () =>
  svgIcon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
const checkIconSvg = () => svgIcon('<polyline points="20 6 9 17 4 12"/>');

// Ligne "identifiant · version" d'un service enregistré. L'identifiant est un bouton :
// un clic le copie (icône copier → coche le temps du retour visuel).
function createUsernameLine(entry) {
  const line = document.createElement("span");
  line.className = "saved-item-username";
  if (!entry.username) {
    line.textContent = `v${entry.version}`;
    return line;
  }

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "saved-item-username-copy";
  copyBtn.setAttribute("aria-label", `Copier l'identifiant ${entry.username}`);
  copyBtn.title = "Copier l'identifiant";
  const copyIcon = copyIconSvg();
  copyIcon.classList.add("icon-copy");
  const checkIcon = checkIconSvg();
  checkIcon.classList.add("icon-check");
  const text = document.createElement("span");
  text.textContent = entry.username;
  copyBtn.append(copyIcon, checkIcon, text);
  copyBtn.addEventListener("click", async () => {
    await copyTextToClipboard(entry.username);
    copyBtn.classList.add("copied");
    window.clearTimeout(copyBtn._copyTimeout);
    copyBtn._copyTimeout = window.setTimeout(() => copyBtn.classList.remove("copied"), 1100);
  });

  line.append(copyBtn, ` · v${entry.version}`);
  return line;
}
const autofillIconSvg = () => svgIcon('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>');

// Injecté dans la page active (sérialisé par chrome.scripting : doit rester autonome,
// sans aucune référence extérieure). Remplit le champ mot de passe visible et, si un
// identifiant est fourni, le champ qui s'y apparente juste avant lui.
//
// Passe par le setter natif de HTMLInputElement (pas juste input.value = ...) et
// déclenche de vrais événements "input"/"change" : sur les sites en React/Vue, une
// simple assignation directe est invisible pour le framework et le formulaire
// resterait vide à la soumission malgré l'affichage.
//
// Formulaires en deux étapes (Google, Microsoft…) : la première page n'a pas encore de
// champ mot de passe, on ne remplit alors que l'identifiant — mais seulement sur un
// champ qui y ressemble clairement, jamais une barre de recherche au hasard.
function fillLoginFields(username, password) {
  const isFillable = (el) =>
    !el.disabled && !el.readOnly && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const setValue = (input, value) => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const passwordInput = password
    ? Array.from(document.querySelectorAll('input[type="password"]')).find(isFillable) ?? null
    : null;

  let usernameInput = null;
  if (username) {
    const scope = passwordInput?.form ?? document;
    let candidates = Array.from(
      scope.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"]')
    ).filter(isFillable);
    if (passwordInput) {
      candidates = candidates.filter(
        (el) => el.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    }

    const HINT = /user|login|logon|email|e-mail|mail|ident|account|compte|pseudo|nickname/i;
    const score = (el) => {
      const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
      if (autocomplete.includes("username") || autocomplete.includes("email")) return 3;
      if (el.type === "email") return 2;
      const described = [el.name, el.id, el.placeholder, el.getAttribute("aria-label")].join(" ");
      return HINT.test(described) ? 1 : 0;
    };

    // Meilleur score ; à égalité, le plus proche du champ mot de passe (le dernier).
    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
      const s = score(el);
      if (s >= bestScore) {
        best = el;
        bestScore = s;
      }
    }
    // Sans formulaire commun avec le mot de passe, un champ texte anonyme pourrait être
    // n'importe quoi (recherche, newsletter…) : on exige alors un indice explicite.
    const sameForm = passwordInput?.form && best?.form === passwordInput.form;
    if (best && (bestScore > 0 || sameForm)) usernameInput = best;
  }

  if (usernameInput) setValue(usernameInput, username);
  if (passwordInput) setValue(passwordInput, password);
  (passwordInput ?? usernameInput)?.focus();
  return { username: usernameInput !== null, password: passwordInput !== null };
}

async function autofillActiveTab(username, password) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { username: false, password: false };
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillLoginFields,
    args: [username || null, password ?? null],
  });
  return injection?.result ?? { username: false, password: false };
}

function autofillResultMessage(entry, filled, hadPassword) {
  if (filled.username && filled.password) {
    return [`Identifiant et mot de passe de ${entry.service} insérés dans la page.`, "success"];
  }
  if (filled.password) {
    return [
      entry.username
        ? `Mot de passe de ${entry.service} inséré (aucun champ identifiant reconnu).`
        : `Mot de passe de ${entry.service} inséré dans la page.`,
      "success",
    ];
  }
  if (filled.username) {
    return [
      hadPassword
        ? "Identifiant inséré. Pas encore de champ mot de passe : reclique sur l'éclair à l'étape suivante."
        : "Identifiant inséré. Renseigne ton Master Secret pour remplir aussi le mot de passe.",
      "success",
    ];
  }
  return ["Aucun champ identifiant ni mot de passe trouvé sur cette page.", "error"];
}

async function renderSavedList() {
  const entries = await listSavedServices(chromeStorageAdapter);

  const showSearch = entries.length >= SEARCH_VISIBLE_THRESHOLD;
  savedSearchFieldEl.hidden = !showSearch;
  if (!showSearch && savedFilterQuery) {
    savedFilterQuery = "";
    savedSearchInput.value = "";
  }

  const query = savedFilterQuery.trim().toLowerCase();
  const filtered = query
    ? entries.filter((entry) => entry.service.includes(query) || entry.username.toLowerCase().includes(query))
    : entries;

  savedListEl.innerHTML = "";
  savedListEl.hidden = filtered.length === 0;
  savedEmptyEl.hidden = entries.length !== 0;
  savedNoMatchEl.hidden = !(entries.length !== 0 && filtered.length === 0);

  const hasKey = hasGeneratorKey();

  // Les services du site ouvert dans l'onglet actif passent en tête, sous leur propre
  // titre : c'est presque toujours celui qu'on vient chercher.
  const currentSite = activeTabUrl ? filtered.filter((entry) => serviceMatchesUrl(entry.service, activeTabUrl)) : [];
  const others = filtered.filter((entry) => !currentSite.includes(entry));

  if (currentSite.length > 0) {
    savedListEl.appendChild(createGroupTitle(`Sur ce site · ${serviceFromUrl(activeTabUrl)}`));
    for (const entry of currentSite) savedListEl.appendChild(createSavedItem(entry, hasKey, true));
    if (others.length > 0) savedListEl.appendChild(createGroupTitle("Autres services"));
  }
  for (const entry of others) savedListEl.appendChild(createSavedItem(entry, hasKey, false));
}

function createGroupTitle(text) {
  const li = document.createElement("li");
  li.className = "saved-group-title";
  li.setAttribute("role", "presentation");
  li.textContent = text;
  return li;
}

function createSavedItem(entry, hasKey, isCurrentSite) {
  const li = document.createElement("li");
  li.className = isCurrentSite ? "saved-item current-site" : "saved-item";

  const header = document.createElement("div");
  header.className = "saved-item-header";

  const info = document.createElement("div");
  info.className = "saved-item-info";
  const serviceSpan = document.createElement("span");
  serviceSpan.className = "saved-item-service";
  serviceSpan.textContent = entry.service;
  info.append(serviceSpan, createUsernameLine(entry));

  const computed = computedPasswords.get(savedEntryKey(entry));

  const autofillBtn = document.createElement("button");
  autofillBtn.type = "button";
  autofillBtn.className = "icon-btn saved-item-autofill";
  autofillBtn.setAttribute(
    "aria-label",
    entry.username
      ? `Remplir l'identifiant et le mot de passe de ${entry.service} dans la page`
      : `Remplir le champ mot de passe de la page avec ${entry.service}`
  );
  autofillBtn.appendChild(autofillIconSvg());
  // Sans mot de passe calculé, l'éclair reste utile pour l'identifiant seul (première
  // étape des connexions en deux temps).
  autofillBtn.disabled = computed === undefined && !entry.username;
  autofillBtn.addEventListener("click", async () => {
    setMessage(savedMessageEl, "Recherche des champs de connexion sur la page...", "");
    try {
      const filled = await autofillActiveTab(entry.username, computed);
      const [text, type] = autofillResultMessage(entry, filled, computed !== undefined);
      setMessage(savedMessageEl, text, type);
    } catch {
      setMessage(
        savedMessageEl,
        "Impossible d'agir sur cette page (page interne du navigateur, ou extension non autorisée ici).",
        "error"
      );
    }
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn saved-item-delete";
  deleteBtn.setAttribute("aria-label", `Supprimer ${entry.service} de la liste`);
  deleteBtn.appendChild(deleteIconSvg());
  deleteBtn.addEventListener("click", async () => {
    await deleteService({ service: entry.service, username: entry.username }, chromeStorageAdapter);
    computedPasswords.delete(savedEntryKey(entry));
    renderSavedList();
  });

  const actions = document.createElement("div");
  actions.className = "saved-item-actions";
  actions.append(autofillBtn, deleteBtn);

  header.append(info, actions);

  const passwordBtn = document.createElement("button");
  passwordBtn.type = "button";
  passwordBtn.className = "saved-item-password";

  if (!hasKey) {
    passwordBtn.textContent = "Renseigne ton Master Secret ci-dessus";
    passwordBtn.addEventListener("click", () => masterSecretInput.focus());
  } else if (computed === undefined) {
    passwordBtn.textContent = "…";
    passwordBtn.disabled = true;
  } else {
    passwordBtn.textContent = savedPasswordsRevealed ? computed : maskPassword(computed);
    passwordBtn.setAttribute("aria-label", `Copier le mot de passe de ${entry.service}`);
    passwordBtn.addEventListener("click", async () => {
      await copyTextToClipboard(computed);
      const previousText = passwordBtn.textContent;
      passwordBtn.textContent = "Copié !";
      passwordBtn.classList.add("copied");
      window.setTimeout(() => {
        passwordBtn.textContent = previousText;
        passwordBtn.classList.remove("copied");
      }, 1100);
    });
  }

  li.append(header, passwordBtn);
  return li;
}

// Volontairement pas de recalcul en live à chaque frappe du Master Secret (PBKDF2 est
// lent par design) : déclenché à l'ouverture du popup, puis au blur/Entrée du champ.
async function recomputeSavedPasswords() {
  computedPasswords.clear();

  await renderSavedList();
  if (!hasGeneratorKey()) return;

  const entries = await listSavedServices(chromeStorageAdapter);
  if (entries.length === 0) return;

  setMessage(savedMessageEl, "Calcul des mots de passe…", "");

  let key;
  try {
    key = await resolveGeneratorKey();
  } catch {
    key = null;
  }
  if (!key) {
    setMessage(savedMessageEl, "", "");
    renderSavedList();
    return;
  }

  // Une seule dérivation PBKDF2 pour toute la liste, puis un HMAC par service.
  for (const entry of entries) {
    try {
      const password = await generateV1WithKey(key, entry);
      computedPasswords.set(savedEntryKey(entry), password);
    } catch {
      // Cette entrée restera sur "…" ; le reste de la liste continue.
    }
  }

  setMessage(savedMessageEl, "", "");
  renderSavedList();
}

toggleMasterSecretBtn.addEventListener("click", () => {
  const isHidden = masterSecretInput.type === "password";
  masterSecretInput.type = isHidden ? "text" : "password";
  toggleMasterSecretBtn.classList.toggle("revealed", isHidden);
  toggleMasterSecretBtn.setAttribute("aria-label", isHidden ? "Masquer le Master Secret" : "Afficher le Master Secret");
});

toggleSavedPasswordsBtn.addEventListener("click", () => {
  savedPasswordsRevealed = !savedPasswordsRevealed;
  toggleSavedPasswordsBtn.classList.toggle("revealed", savedPasswordsRevealed);
  toggleSavedPasswordsBtn.setAttribute("aria-expanded", String(savedPasswordsRevealed));
  toggleSavedPasswordsBtn.setAttribute(
    "aria-label",
    savedPasswordsRevealed ? "Masquer les mots de passe" : "Afficher les mots de passe en clair"
  );
  renderSavedList();
});

savedSearchInput.addEventListener("input", () => {
  savedFilterQuery = savedSearchInput.value;
  renderSavedList();
});

// --- Export / import de la liste enregistrée (jamais le mot de passe, jamais le
// Master Secret — juste service/identifiant/version/longueur/profil) ---

const savedExportBtn = document.getElementById("saved-export-btn");
const savedImportBtn = document.getElementById("saved-import-btn");
const savedImportFileInput = document.getElementById("saved-import-file");
const settingsMessageEl = document.getElementById("settings-message");

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

savedExportBtn.addEventListener("click", async () => {
  const exported = await exportSavedServices(chromeStorageAdapter);
  if (exported.entries.length === 0) {
    setMessage(settingsMessageEl, "Rien à exporter pour l'instant.", "error");
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  downloadJson(`password-crypter-services-${date}.json`, exported);
  setMessage(settingsMessageEl, `${exported.entries.length} service(s) exporté(s).`, "success");
});

savedImportBtn.addEventListener("click", () => savedImportFileInput.click());

savedImportFileInput.addEventListener("change", async () => {
  const file = savedImportFileInput.files[0];
  savedImportFileInput.value = ""; // permet de réimporter le même fichier une 2e fois
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    setMessage(settingsMessageEl, "Ce fichier n'est pas un JSON valide.", "error");
    return;
  }

  try {
    const count = await importSavedServices(data, chromeStorageAdapter);
    setMessage(settingsMessageEl, `${count} service(s) importé(s).`, "success");
    recomputeSavedPasswords();
  } catch (err) {
    setMessage(settingsMessageEl, err.message || "Impossible d'importer ce fichier.", "error");
  }
});

// --- Onglets ---

const tabButtons = Array.from(document.querySelectorAll(".tab"));

// "saved" est l'onglet actif par défaut (celui qu'on ouvre en premier pour
// retrouver un mot de passe vite fait) — doit rester synchro avec la classe
// "active" posée sur le bon bouton dans popup.html.
let activeTabName = "saved";

function activateTab(tabName) {
  activeTabName = tabName;
  for (const btn of tabButtons) {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
    document.getElementById(`panel-${btn.dataset.tab}`).hidden = !isActive;
  }
  if (tabName === "saved") recomputeSavedPasswords();
  if (tabName === "generator") prefillDetectedService();
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

// --- Réglages ---
// Pas un onglet parmi les autres : une vue à part, ouverte via l'icône ⚙ de l'en-tête,
// qui prend toute la place et se referme sur l'onglet qu'on regardait avant.

const tabsEl = document.querySelector(".tabs");
const settingsPanelEl = document.getElementById("panel-settings");
const settingsToggleBtn = document.getElementById("settings-toggle-btn");
const settingsBackBtn = document.getElementById("settings-back-btn");

function openSettings() {
  tabsEl.hidden = true;
  settingsToggleBtn.hidden = true;
  document.getElementById(`panel-${activeTabName}`).hidden = true;
  settingsPanelEl.hidden = false;
}

function closeSettings() {
  settingsPanelEl.hidden = true;
  tabsEl.hidden = false;
  settingsToggleBtn.hidden = false;
  document.getElementById(`panel-${activeTabName}`).hidden = false;
}

settingsToggleBtn.addEventListener("click", openSettings);
settingsBackBtn.addEventListener("click", closeSettings);

// "Enregistrés" est l'onglet par défaut : on y tape souvent le Master Secret sans
// jamais cliquer sur un onglet. On recalcule donc aussi quand ce champ perd le
// focus ou sur Entrée, tant qu'on est toujours sur cet onglet-là.
masterSecretInput.addEventListener("blur", () => {
  if (activeTabName === "saved") recomputeSavedPasswords();
});
masterSecretInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && activeTabName === "saved") {
    event.preventDefault();
    recomputeSavedPasswords();
  }
});

// --- Générateur (créer et sauvegarder un nouveau service depuis le popup) ---

const genServiceInput = document.getElementById("gen-service");
const genUsernameInput = document.getElementById("gen-username");
const genVersionInput = document.getElementById("gen-version");
const genLengthInput = document.getElementById("gen-length");
const genProfileSelect = document.getElementById("gen-profile");
const genOutputInput = document.getElementById("gen-output");
const genMessageEl = document.getElementById("gen-message");
const genGenerateBtn = document.getElementById("gen-generate-btn");
const genSaveBtn = document.getElementById("gen-save-btn");
const genServiceHintEl = document.getElementById("gen-service-hint");

// Pré-remplit le service avec le domaine de l'onglet actif, sans jamais écraser ce qui
// a été tapé. Le service fait partie de la recette du mot de passe : l'indice sous le
// champ rappelle qu'il a été deviné et qu'on peut le corriger.
function prefillDetectedService() {
  const detected = activeTabUrl ? serviceFromUrl(activeTabUrl) : null;
  if (!detected || genServiceInput.value.trim()) return;
  genServiceInput.value = detected;
  genServiceHintEl.textContent = "Détecté depuis l'onglet actif — modifiable.";
  genServiceHintEl.hidden = false;
}

genServiceInput.addEventListener("input", () => {
  genServiceHintEl.hidden = true;
});

genGenerateBtn.addEventListener("click", () =>
  withBusyButton(genGenerateBtn, async () => {
    if (!genServiceInput.value.trim()) {
      setMessage(genMessageEl, "Renseigne au moins le service.", "error");
      return;
    }
    const length = readValidLength(genMessageEl);
    if (length === null) return;
    try {
      const key = await requireGeneratorKey(genMessageEl);
      if (!key) return;
      genOutputInput.value = await generateV1WithKey(key, {
        service: genServiceInput.value,
        username: genUsernameInput.value,
        version: genVersionInput.value || 1,
        length,
        profile: genProfileSelect.value,
      });
      setMessage(genMessageEl, "Généré.", "success");
    } catch {
      setMessage(genMessageEl, "Une erreur inattendue est survenue.", "error");
    }
  })
);

genSaveBtn.addEventListener("click", async () => {
  const length = readValidLength(genMessageEl);
  if (length === null) return;
  try {
    await saveService(
      {
        service: genServiceInput.value,
        username: genUsernameInput.value,
        version: genVersionInput.value || 1,
        length,
        profile: genProfileSelect.value,
      },
      chromeStorageAdapter
    );
    setMessage(genMessageEl, "Service enregistré — retrouve-le dans l'onglet Enregistrés.", "success");
  } catch (err) {
    setMessage(genMessageEl, err.message || "Impossible d'enregistrer ce service.", "error");
  }
});

document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = document.getElementById(btn.dataset.target);
    if (!target.value) return;
    await copyTextToClipboard(target.value);
    btn.classList.add("copied");
    window.clearTimeout(btn._copyTimeout);
    btn._copyTimeout = window.setTimeout(() => btn.classList.remove("copied"), 1200);
  });
});

// Ouverture du popup : si une clé est encore mémorisée, les mots de passe sont prêts
// sans rien retaper.
async function init() {
  rememberMinutes = await loadRememberMinutes();
  renderRememberMenu();
  await Promise.all([loadSession(), loadActiveTabUrl()]);
  await recomputeSavedPasswords();
}

init();
