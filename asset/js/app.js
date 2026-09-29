"use strict";

import { encryptV2, decryptV2 } from "./crypto/encryption.js";
import { generateV1, MIN_LENGTH, MAX_LENGTH } from "./crypto/deterministicPassword.js";
import { PasswordCrypterError } from "./crypto/errors.js";
import {
  listSavedServices,
  saveService,
  deleteService,
  exportSavedServices,
  importSavedServices,
} from "./storage/savedServices.js";

const masterSecretInput = document.getElementById("master-secret");

function setMessage(scope, text, type) {
  const el = document.getElementById(`${scope}-message`);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("error", "success");
  if (type) el.classList.add(type);
}

function friendlyErrorMessage(err) {
  if (err instanceof PasswordCrypterError) return err.message;
  return "Une erreur inattendue est survenue.";
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

function requireMasterSecret(scope) {
  const value = masterSecretInput.value;
  if (!value) {
    setMessage(scope, "Renseigne un Master Secret.", "error");
    return null;
  }
  return value;
}

// --- Secret ---

function wireEncryptDecrypt(scope) {
  const plainField = document.getElementById(`${scope}-plain`);
  const cipherField = document.getElementById(`${scope}-cipher`);

  const encryptBtn = document.querySelector(`[data-action="encrypt"][data-scope="${scope}"]`);
  const decryptBtn = document.querySelector(`[data-action="decrypt"][data-scope="${scope}"]`);

  encryptBtn.addEventListener("click", () =>
    withBusyButton(encryptBtn, async () => {
      const masterSecret = requireMasterSecret(scope);
      if (!masterSecret) return;
      if (!plainField.value) {
        setMessage(scope, "Rien à chiffrer pour l'instant.", "error");
        return;
      }
      try {
        cipherField.value = await encryptV2(masterSecret, plainField.value);
        setMessage(scope, "Chiffré.", "success");
      } catch (err) {
        setMessage(scope, friendlyErrorMessage(err), "error");
      }
    })
  );

  decryptBtn.addEventListener("click", () =>
    withBusyButton(decryptBtn, async () => {
      const masterSecret = requireMasterSecret(scope);
      if (!masterSecret) return;
      if (!cipherField.value) {
        setMessage(scope, "Colle d'abord une valeur chiffrée.", "error");
        return;
      }
      try {
        plainField.value = await decryptV2(masterSecret, cipherField.value.trim());
        setMessage(scope, "Déchiffré.", "success");
      } catch (err) {
        setMessage(scope, friendlyErrorMessage(err), "error");
      }
    })
  );
}

wireEncryptDecrypt("secret");

// --- Générateur déterministe ---

const genServiceInput = document.getElementById("gen-service");
const genUsernameInput = document.getElementById("gen-username");
const genVersionInput = document.getElementById("gen-version");
const genLengthInput = document.getElementById("gen-length");
const genProfileSelect = document.getElementById("gen-profile");
const genOutputInput = document.getElementById("gen-output");
const genBtn = document.querySelector('[data-action="generate"][data-scope="gen"]');

// Bornes UI (voir deterministicPassword.js) : le calcul crypto lui-même accepte
// n'importe quelle longueur positive, cette limite 6-32 colle juste aux contraintes
// réelles des sites (ex. certaines banques imposent 8 caractères).
function readValidLength(scope) {
  const length = Number(genLengthInput.value);
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    setMessage(scope, `La longueur doit être un nombre entier entre ${MIN_LENGTH} et ${MAX_LENGTH}.`, "error");
    return null;
  }
  return length;
}

genBtn.addEventListener("click", () =>
  withBusyButton(genBtn, async () => {
    const masterSecret = requireMasterSecret("gen");
    if (!masterSecret) return;
    if (!genServiceInput.value.trim()) {
      setMessage("gen", "Renseigne au moins le service.", "error");
      return;
    }
    const length = readValidLength("gen");
    if (length === null) return;
    try {
      genOutputInput.value = await generateV1(masterSecret, {
        service: genServiceInput.value,
        username: genUsernameInput.value,
        version: genVersionInput.value || 1,
        length,
        profile: genProfileSelect.value,
      });
      setMessage("gen", "Généré.", "success");
    } catch (err) {
      setMessage("gen", friendlyErrorMessage(err), "error");
    }
  })
);

// --- Presse-papiers (partagé avec les boutons copier ci-dessous) ---

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

// --- Services enregistrés (service + identifiant + version + longueur + profil,
// jamais le Master Secret ni le mot de passe lui-même) ---

const savedListEl = document.getElementById("saved-list");
const savedEmptyEl = document.getElementById("saved-empty");
const savedNoMatchEl = document.getElementById("saved-no-match");
const savedMessageEl = document.getElementById("saved-message");
const savedSearchFieldEl = document.getElementById("saved-search-field");
const savedSearchInput = document.getElementById("saved-search");
const genSaveBtn = document.querySelector('[data-action="save"][data-scope="gen"]');
const toggleSavedPasswordsBtn = document.getElementById("toggle-saved-passwords");

// service+identifiant -> mot de passe déjà recalculé pour la session en cours.
// Jamais persisté : recalculé à chaque activation de l'onglet à partir du Master
// Secret présent à ce moment-là dans le champ partagé.
const computedPasswords = new Map();
let savedPasswordsRevealed = false;
let savedFilterQuery = "";

// En dessous de ce nombre d'entrées, filtrer n'apporte rien : autant garder
// l'interface simple et ne montrer la recherche que quand elle devient utile.
const SEARCH_VISIBLE_THRESHOLD = 8;

function savedEntryKey(entry) {
  return `${entry.service} ${entry.username}`;
}

function maskPassword(password) {
  return "•".repeat(password.length);
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

// N'utilise que ce qui est déjà dans computedPasswords, ne relance jamais de calcul
// crypto (voir recomputeSavedPasswords pour ça) — reste async seulement parce que
// lire la liste enregistrée (listSavedServices) l'est, par cohérence avec
// chrome.storage.local côté extension.
async function renderSavedList() {
  const entries = await listSavedServices();

  const showSearch = entries.length >= SEARCH_VISIBLE_THRESHOLD;
  savedSearchFieldEl.hidden = !showSearch;
  if (!showSearch && savedFilterQuery) {
    savedFilterQuery = "";
    savedSearchInput.value = "";
  }

  const query = savedFilterQuery.trim().toLowerCase();
  const filtered = query
    ? entries.filter(
        (entry) => entry.service.includes(query) || entry.username.toLowerCase().includes(query)
      )
    : entries;

  savedListEl.innerHTML = "";
  savedListEl.hidden = filtered.length === 0;
  savedEmptyEl.hidden = entries.length !== 0;
  savedNoMatchEl.hidden = !(entries.length !== 0 && filtered.length === 0);

  const hasMasterSecret = Boolean(masterSecretInput.value);

  for (const entry of filtered) {
    const li = document.createElement("li");
    li.className = "saved-item";

    const header = document.createElement("div");
    header.className = "saved-item-header";

    const info = document.createElement("div");
    info.className = "saved-item-info";
    const serviceSpan = document.createElement("span");
    serviceSpan.className = "saved-item-service";
    serviceSpan.textContent = entry.service;
    info.append(serviceSpan, createUsernameLine(entry));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-btn saved-item-delete";
    deleteBtn.setAttribute("aria-label", `Supprimer ${entry.service} de la liste`);
    deleteBtn.appendChild(deleteIconSvg());
    deleteBtn.addEventListener("click", async () => {
      await deleteService({ service: entry.service, username: entry.username });
      computedPasswords.delete(savedEntryKey(entry));
      renderSavedList();
    });

    header.append(info, deleteBtn);

    const passwordBtn = document.createElement("button");
    passwordBtn.type = "button";
    passwordBtn.className = "saved-item-password";

    const computed = computedPasswords.get(savedEntryKey(entry));

    if (!hasMasterSecret) {
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
    savedListEl.appendChild(li);
  }
}

// Recalcule tous les mots de passe enregistrés à partir du Master Secret actuel.
// Volontairement pas de recalcul en live à chaque frappe (PBKDF2 est lent par
// design) : ça se déclenche uniquement à l'activation de l'onglet "Enregistrés".
async function recomputeSavedPasswords() {
  const masterSecret = masterSecretInput.value;
  computedPasswords.clear();

  // Vide la liste tout de suite : évite qu'un ancien mot de passe (calculé avec
  // un Master Secret différent) reste cliquable/copiable pendant le recalcul.
  await renderSavedList();

  if (!masterSecret) return;

  const entries = await listSavedServices();
  if (entries.length === 0) return;

  savedMessageEl.textContent = "Calcul des mots de passe…";
  savedMessageEl.classList.remove("error", "success");

  for (const entry of entries) {
    try {
      const password = await generateV1(masterSecret, entry);
      computedPasswords.set(savedEntryKey(entry), password);
    } catch {
      // Cette entrée restera sur "…" ; le reste de la liste continue.
    }
  }

  savedMessageEl.textContent = "";
  renderSavedList();
}

genSaveBtn.addEventListener("click", async () => {
  const length = readValidLength("gen");
  if (length === null) return;
  try {
    await saveService({
      service: genServiceInput.value,
      username: genUsernameInput.value,
      version: genVersionInput.value || 1,
      length,
      profile: genProfileSelect.value,
    });
    setMessage("gen", "Service enregistré.", "success");
  } catch (err) {
    setMessage("gen", err.message || "Impossible d'enregistrer ce service.", "error");
  }
});

toggleSavedPasswordsBtn.addEventListener("click", () => {
  savedPasswordsRevealed = !savedPasswordsRevealed;
  toggleSavedPasswordsBtn.classList.toggle("revealed", savedPasswordsRevealed);
  toggleSavedPasswordsBtn.setAttribute(
    "aria-expanded",
    String(savedPasswordsRevealed)
  );
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
  const exported = await exportSavedServices();
  if (exported.entries.length === 0) {
    setMessage("settings", "Rien à exporter pour l'instant.", "error");
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  downloadJson(`password-crypter-services-${date}.json`, exported);
  setMessage("settings", `${exported.entries.length} service(s) exporté(s).`, "success");
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
    setMessage("settings", "Ce fichier n'est pas un JSON valide.", "error");
    return;
  }

  try {
    const count = await importSavedServices(data);
    setMessage("settings", `${count} service(s) importé(s).`, "success");
    recomputeSavedPasswords();
  } catch (err) {
    setMessage("settings", err.message || "Impossible d'importer ce fichier.", "error");
  }
});

renderSavedList();

// --- Onglets ---

const tabButtons = Array.from(document.querySelectorAll(".tab"));

// "saved" est l'onglet actif par défaut dans le HTML (celui qu'on ouvre en premier,
// pour retrouver un mot de passe vite fait). Doit rester synchro avec la classe
// "active" posée sur le bon bouton dans index.html.
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

// --- Textes d'aide repliables (uniquement visibles/dépliables sur mobile, cf. CSS) ---

document.querySelectorAll(".help-toggle").forEach((btn) => {
  const target = document.getElementById(btn.getAttribute("aria-controls"));
  btn.addEventListener("click", () => {
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!expanded));
    target.classList.toggle("expanded", !expanded);
  });
});

// --- Afficher/masquer le Master Secret ---
// (bouton distinct de #toggle-saved-passwords : même style ".eye-toggle", mais
// comportement différent — celui-ci bascule le type de l'input, l'autre bascule
// l'affichage de toute une liste — donc câblés séparément plutôt que via une
// boucle générique sur ".eye-toggle".)

const toggleMasterSecretBtn = document.getElementById("toggle-master-secret");

toggleMasterSecretBtn.addEventListener("click", () => {
  const isHidden = masterSecretInput.type === "password";
  masterSecretInput.type = isHidden ? "text" : "password";
  toggleMasterSecretBtn.classList.toggle("revealed", isHidden);
  toggleMasterSecretBtn.setAttribute("aria-label", isHidden ? "Masquer le Master Secret" : "Afficher le Master Secret");
});

// "Enregistrés" est l'onglet par défaut : on y tape souvent le Master Secret sans
// jamais cliquer sur un onglet (ce qui déclencherait recomputeSavedPasswords). On
// recalcule donc aussi quand ce champ perd le focus ou sur Entrée, tant qu'on est
// toujours sur cet onglet-là.
masterSecretInput.addEventListener("blur", () => {
  if (activeTabName === "saved") recomputeSavedPasswords();
});

masterSecretInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && activeTabName === "saved") {
    event.preventDefault();
    recomputeSavedPasswords();
  }
});

// --- Copier dans le presse-papiers ---

document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = document.getElementById(btn.dataset.target);
    if (!target.value) return;

    try {
      await navigator.clipboard.writeText(target.value);
    } catch (err) {
      target.select();
      document.execCommand("copy");
    }

    btn.classList.add("copied");
    window.clearTimeout(btn._copyTimeout);
    btn._copyTimeout = window.setTimeout(() => btn.classList.remove("copied"), 1200);
  });
});

// --- PWA : app shell hors-ligne + installabilité ---

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // app.js est un module chargé depuis asset/js/ : ses URL relatives se résolvent
    // par rapport à SON propre emplacement, pas à celui de la page. sw.js vit à la
    // racine du site (pour que son scope couvre toute l'app), donc on résout le
    // chemin par rapport au document lui-même, pas au module.
    const swUrl = new URL("sw.js", document.baseURI).href;
    navigator.serviceWorker.register(swUrl).catch(() => {
      // L'app reste utilisable sans service worker (juste pas d'installation/hors-ligne).
    });
  });
}
