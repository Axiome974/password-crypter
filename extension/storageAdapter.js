// Même interface async (getItem/setItem) que l'adaptateur localStorage utilisé par
// défaut dans asset/js/storage/savedServices.js — seul le backend change ici.
// chrome.storage.local est isolé par extension : illisible par le JS d'une page web.

export const chromeStorageAdapter = {
  async getItem(key) {
    const result = await chrome.storage.local.get(key);
    return key in result ? result[key] : null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};
