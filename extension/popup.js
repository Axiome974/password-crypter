"use strict";

import { generateV1, MIN_LENGTH, MAX_LENGTH } from "./asset/js/crypto/deterministicPassword.js";
import {
  listSavedServices,
  saveService,
  deleteService,
  exportSavedServices,
  importSavedServices,
} from "./asset/js/storage/savedServices.js";
import { chromeStorageAdapter } from "./storageAdapter.js";

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

function requireMasterSecret(messageEl) {
  const value = masterSecretInput.value;
  if (!value) {
    setMessage(messageEl, "Renseigne un Master Secret.", "error");
    return null;
  }
  return value;
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
const autofillIconSvg = () => svgIcon('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>');

// Injecté dans la page active : cherche le premier champ mot de passe et y colle la
// valeur. Passe par le setter natif de HTMLInputElement (pas juste input.value = ...)
// et déclenche un vrai événement "input" : sur les sites en React/Vue, une simple
// assignation directe est invisible pour le framework et le formulaire resterait vide
// à la soumission malgré l'affichage.
function fillFirstPasswordField(password) {
  const input = document.querySelector('input[type="password"]');
  if (!input) return false;
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  nativeSetter.call(input, password);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.focus();
  return true;
}

async function autofillActiveTab(password) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillFirstPasswordField,
    args: [password],
  });
  return injection?.result === true;
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
    const usernameSpan = document.createElement("span");
    usernameSpan.className = "saved-item-username";
    usernameSpan.textContent = entry.username ? `${entry.username} · v${entry.version}` : `v${entry.version}`;
    info.append(serviceSpan, usernameSpan);

    const computed = computedPasswords.get(savedEntryKey(entry));

    const autofillBtn = document.createElement("button");
    autofillBtn.type = "button";
    autofillBtn.className = "icon-btn saved-item-autofill";
    autofillBtn.setAttribute("aria-label", `Remplir le champ mot de passe de la page avec ${entry.service}`);
    autofillBtn.appendChild(autofillIconSvg());
    autofillBtn.disabled = computed === undefined;
    autofillBtn.addEventListener("click", async () => {
      setMessage(savedMessageEl, "Recherche du champ mot de passe sur la page...", "");
      try {
        const filled = await autofillActiveTab(computed);
        setMessage(
          savedMessageEl,
          filled ? `Mot de passe de ${entry.service} inséré dans la page.` : "Aucun champ mot de passe trouvé sur cette page.",
          filled ? "success" : "error"
        );
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

// Volontairement pas de recalcul en live à chaque frappe du Master Secret (PBKDF2 est
// lent par design) : déclenché à l'ouverture du popup, puis au blur/Entrée du champ.
async function recomputeSavedPasswords() {
  const masterSecret = masterSecretInput.value;
  computedPasswords.clear();

  await renderSavedList();
  if (!masterSecret) return;

  const entries = await listSavedServices(chromeStorageAdapter);
  if (entries.length === 0) return;

  setMessage(savedMessageEl, "Calcul des mots de passe…", "");

  for (const entry of entries) {
    try {
      const password = await generateV1(masterSecret, entry);
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

genGenerateBtn.addEventListener("click", () =>
  withBusyButton(genGenerateBtn, async () => {
    const masterSecret = requireMasterSecret(genMessageEl);
    if (!masterSecret) return;
    if (!genServiceInput.value.trim()) {
      setMessage(genMessageEl, "Renseigne au moins le service.", "error");
      return;
    }
    const length = readValidLength(genMessageEl);
    if (length === null) return;
    try {
      genOutputInput.value = await generateV1(masterSecret, {
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

renderSavedList();
