// Service worker minimal : sa seule mission est d'effacer la clé mémorisée à
// l'échéance choisie, même si le popup n'est jamais rouvert (voir masterSession.js).

import { LOCK_ALARM, SESSION_KEY } from "./masterSession.js";

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM) chrome.storage.session.remove(SESSION_KEY);
});
