"use strict";

// 64 caractères (puissance de 2) : un XOR d'indices reste toujours dans [0, 63],
// ce qui rend la transformation involutive -> chiffrer et déchiffrer sont la même opération.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function charIndex(char) {
  const index = ALPHABET.indexOf(char);
  if (index !== -1) return index;
  return char.codePointAt(0) % ALPHABET.length;
}

function transform(key, text) {
  if (!key || !text) return "";
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const keyIndex = charIndex(key[i % key.length]);
    const textIndex = charIndex(text[i]);
    result += ALPHABET[textIndex ^ keyIndex];
  }
  return result;
}

const keyInput = document.getElementById("key");
const clearInput = document.getElementById("clear");
const cipherInput = document.getElementById("cipher");
const toggleKeyBtn = document.getElementById("toggle-key");

let lastEdited = "clear";

function recompute() {
  const key = keyInput.value;
  if (lastEdited === "clear") {
    cipherInput.value = transform(key, clearInput.value);
  } else {
    clearInput.value = transform(key, cipherInput.value);
  }
}

keyInput.addEventListener("input", recompute);

clearInput.addEventListener("input", () => {
  lastEdited = "clear";
  recompute();
});

cipherInput.addEventListener("input", () => {
  lastEdited = "cipher";
  recompute();
});

toggleKeyBtn.addEventListener("click", () => {
  const isHidden = keyInput.type === "password";
  keyInput.type = isHidden ? "text" : "password";
  toggleKeyBtn.classList.toggle("revealed", isHidden);
  toggleKeyBtn.setAttribute("aria-label", isHidden ? "Masquer la clé" : "Afficher la clé");
});

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
