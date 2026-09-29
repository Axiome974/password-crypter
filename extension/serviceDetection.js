// Détection du service à partir de l'URL de l'onglet actif. Module pur (aucune API
// chrome.*) pour rester testable sous Node.
//
// On raisonne sur le "domaine enregistrable" (eTLD+1) : accounts.google.com et
// mail.google.com donnent tous deux google.com. Sans embarquer toute la Public Suffix
// List, une courte liste des suffixes à plusieurs niveaux les plus courants suffit ;
// un suffixe absent retombe sur les deux derniers labels, ce qui reste un bon défaut.
//
// Important : le service fait partie de l'entrée du générateur. La détection ne sert
// qu'à pré-remplir / suggérer — elle ne change jamais un service déjà enregistré.

const MULTI_LABEL_SUFFIXES = new Set([
  // Suffixes publics de second niveau courants
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "co.jp", "co.kr", "co.in", "co.za",
  "com.br", "com.mx", "com.ar", "com.cn", "com.tr", "com.tw", "com.sg", "com.hk",
  "gouv.fr", "asso.fr",
  // Hébergeurs où chaque sous-domaine est un site distinct
  "github.io", "gitlab.io", "pages.dev", "vercel.app", "netlify.app",
  "herokuapp.com", "web.app", "firebaseapp.com", "blogspot.com",
]);

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

function hostnameFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return hostname || null;
}

export function registrableDomain(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  // IPv6 (entre crochets dans une URL), IPv4, localhost… : rien à regrouper.
  if (host.includes(":") || IPV4_PATTERN.test(host) || !host.includes(".")) return host;

  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");
  const take = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join(".");
}

// Service à proposer dans le générateur pour cette URL, ou null (page interne du
// navigateur, fichier local, URL invalide…).
export function serviceFromUrl(url) {
  const hostname = hostnameFromUrl(url);
  return hostname ? registrableDomain(hostname) : null;
}

// Un service enregistré peut être un domaine ("github.com"), un sous-domaine
// ("mail.google.com"), une URL collée telle quelle, ou un simple nom ("github").
// Tous ces cas doivent être reconnus sur n'importe quelle page du même site.
export function serviceMatchesUrl(service, url) {
  const hostname = hostnameFromUrl(url);
  if (!hostname) return false;

  let candidate = service.trim().toLowerCase();
  if (!candidate) return false;
  if (candidate.includes("://")) {
    candidate = hostnameFromUrl(candidate);
    if (!candidate) return false;
  }
  candidate = candidate.replace(/\.$/, "");

  const pageDomain = registrableDomain(hostname);

  if (!candidate.includes(".")) {
    // Nom nu : "github" ↔ github.com, "amazon" ↔ amazon.co.uk.
    return pageDomain.split(".")[0] === candidate || hostname === candidate;
  }
  return candidate === hostname || registrableDomain(candidate) === pageDomain;
}
