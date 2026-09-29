# Password Crypter

Outil 100 % client-side (HTML/CSS/JS vanilla, sans framework ni dépendance
d'exécution) pour gérer des secrets à partir d'un seul **Master Secret**
mémorisé, jamais stocké, jamais transmis. Tout le calcul cryptographique se
fait dans le navigateur, via l'API Web Crypto native.

Trois onglets, dans l'ordre où ils apparaissent (le plus utilisé au quotidien
en premier, pensé pour vivre à côté d'un gestionnaire comme Bitwarden) :

- **Enregistrés** — onglet par défaut. Liste des services sauvegardés.
  Renseigne ton Master Secret (le calcul se relance dès que le champ perd le
  focus ou sur Entrée, tant que tu es sur cet onglet) : les mots de passe
  sont recalculés à la volée et affichés masqués (des points) ; un clic sur
  une ligne copie le mot de passe en clair dans le presse-papiers, sans
  jamais l'afficher par erreur. Un bouton dédié permet de tout révéler en
  clair d'un coup. À partir de 8 services enregistrés, un champ de recherche
  apparaît pour filtrer par service/identifiant en direct.
- **Générateur** — recalcule un mot de passe fort de façon déterministe à
  partir du Master Secret + service + identifiant + version, sans jamais
  l'enregistrer nulle part.
- **Secret** — chiffre une note (texte libre, ou un indice personnel pour
  retrouver un mot de passe oublié) que tu ne peux rouvrir qu'avec le même
  Master Secret.

## Format de chiffrement — `secret/v2` (préfixe `PC2.`)

```
PBKDF2-SHA256 (600 000 itérations, salt aléatoire 16 octets)
  → clé AES-256
AES-256-GCM (IV aléatoire 12 octets, AAD = "password-crypter/secret/v2")
```

Le blob final est `PC2.` + base64url(JSON `{v, kdf, iter, salt, iv, ct}`) —
texte, copiable, collable, autonome (tout ce qu'il faut au déchiffrement,
sauf le Master Secret, est dans le blob). AES-GCM authentifie le contenu : une
mauvaise clé ou un blob altéré échoue proprement au lieu de rendre du texte
corrompu. Le format est versionné (`v: 2`) pour permettre un futur `v3` sans
casser la lecture des secrets existants.

Code : `asset/js/crypto/keyDerivation.js`, `asset/js/crypto/encryption.js`.

## Générateur déterministe — `generator/v1`

```
Master Secret
  → PBKDF2-SHA256 (salt fixe = namespace, 200 000 itérations)
  → clé dérivée
  → HMAC-SHA-256(clé, JSON[namespace, service, identifiant, version])
  → flux d'octets étendu en mode compteur si besoin
  → mappage vers l'alphabet du profil choisi (rejection sampling, sans biais)
```

Namespace fixe et versionné : `password-crypter/generator/v1`. Mêmes entrées
= même mot de passe, à chaque fois, pour toujours — c'est tout l'intérêt :
rien à synchroniser, rien à sauvegarder. Changer la version régénère un mot
de passe totalement différent (utile pour révoquer un mot de passe compromis
sans changer de Master Secret).

Normalisation (`normalizeGeneratorInputs()`, centralisée et volontairement
minimale) : `service` en minuscules et sans espaces superflus, `identifiant`
sans espaces superflus (casse conservée), `version` entier. Le Master Secret
n'est jamais modifié.

Profils : Standard (lettres, chiffres, symboles), Alphanumérique, Sans
caractères ambigus (exclut `0 O o 1 l I`), Chiffres uniquement (pour les
sites — souvent bancaires — qui n'acceptent qu'un code numérique). Longueur
libre entre 6 et 32 (défaut 20) : cette borne est une contrainte d'interface
(`MIN_LENGTH`/`MAX_LENGTH` dans `deterministicPassword.js`), pas une limite
du calcul crypto lui-même, qui accepte n'importe quelle longueur positive.

Cet algorithme est figé pour toujours sous le nom `generator/v1` : une
évolution future crée `generator/v2` à côté plutôt que de le modifier — voir
le test à vecteur fixe dans `tests/deterministicPassword.test.js`, qui doit
échouer si jamais ce comportement changeait silencieusement.

Code : `asset/js/crypto/deterministicPassword.js`.

## Services enregistrés (`localStorage`)

Onglet "Enregistrés" : une liste de `{service, username, version, length,
profile}` que tu choisis explicitement de sauvegarder (bouton "Enregistrer ce
service" dans le générateur). `length`/`profile` sont indispensables : sans
eux, recalculer depuis cette liste pourrait donner un mot de passe différent
de celui réellement utilisé si un profil ou une longueur non standard avait
été choisi. Clé par `service + identifiant` : ré-enregistrer avec une version
différente remplace l'entrée existante au lieu d'empiler des doublons.

L'app recalcule (avec le Master Secret présent à cet instant dans le champ
partagé) le mot de passe de chaque entrée enregistrée et l'affiche masqué
(des points), jamais en clair par défaut. Un clic sur une ligne copie le mot
de passe réel dans le presse-papiers ; un bouton dédié permet de révéler tout
en clair d'un coup. Volontairement pas de recalcul en live à chaque frappe du
Master Secret (PBKDF2 est lent par design) : le recalcul se déclenche à
l'activation de l'onglet "Enregistrés", et — comme c'est l'onglet ouvert par
défaut, donc souvent celui où on tape son Master Secret pour la première fois
— aussi quand ce champ perd le focus ou sur Entrée.

À partir de 8 entrées, un champ de recherche apparaît pour filtrer la liste
par service ou identifiant (filtrage pur côté affichage, aucun recalcul
crypto déclenché).

Ce qui n'est **jamais** stocké : le Master Secret, et le mot de passe généré
lui-même — ce dernier vit uniquement en mémoire (un `Map` JS, jamais persisté
sur disque) le temps de la session, tant que l'onglet "Enregistrés" a été
ouvert. Sans le Master Secret, la liste stockée ne permet à personne de
reconstruire un mot de passe — au pire elle révèle quels comptes existent
sur cet appareil, exactement comme la liste de sites d'un gestionnaire de
mots de passe classique.

Le site utilise `localStorage` (portée à l'origine du site, illisible par
d'autres sites). `asset/js/storage/savedServices.js` expose une API 100%
async (`getItem`/`setItem` sur le store passé en paramètre) précisément pour
pouvoir brancher un autre backend sans rien changer à la logique — c'est ce
que fait l'extension de navigateur (voir plus bas) avec `chrome.storage.local`.

### Réglages, export / import

Icône ⚙ dans l'en-tête (site et extension) : ouvre une vue "Réglages" à part
— pas un onglet parmi les autres, une bascule qui masque temporairement les
onglets et revient sur celui qu'on regardait avant (bouton "← Retour").
Pensé pour accueillir d'autres réglages plus tard (thème...), pour l'instant
elle ne contient que l'export/import.

Boutons "Exporter"/"Importer", pour transférer sa liste de services vers un
autre appareil ou entre le site et l'extension. Fichier JSON téléchargé/relu
directement dans
le navigateur (`Blob` + `<a download>` / `<input type="file">`), aucun
serveur impliqué. Contenu du fichier : exactement le même modèle que le
stockage — `{service, username, version, length, profile}` par entrée,
**jamais** un mot de passe ni le Master Secret. Le pire cas de fuite si ce
fichier traîne quelque part reste "voici mes comptes", pas "voici mes mots
de passe".

Format versionné indépendamment du stockage interne (`EXPORT_FORMAT_VERSION`,
distinct du `SCHEMA_VERSION` de `localStorage`/`chrome.storage.local`) pour
qu'un fichier exporté aujourd'hui reste lisible même si le format de
stockage change un jour. Importer réutilise `saveService()` pour chaque
entrée — même normalisation, mêmes bornes de longueur, et upsert par
service+identifiant : une entrée importée qui existe déjà en local est
remplacée par la version du fichier plutôt que dupliquée. Un fichier
malformé, d'un autre type, ou d'une version d'export non supportée est
rejeté avec un message clair ; une entrée individuellement invalide dans un
fichier par ailleurs correct est ignorée sans bloquer l'import du reste.

## Extension de navigateur (`extension/`)

Popup à deux onglets, volontairement sans l'onglet "Secret" (pas de cas
d'usage évident pour chiffrer une note depuis un popup d'extension) :

- **Enregistrés** (par défaut) — copier / révéler / supprimer / filtrer,
  identique à l'onglet du même nom sur le site.
- **Générateur** — mêmes champs que sur le site (service, identifiant,
  version, longueur, profil), avec "Générer" et "Enregistrer ce service" :
  de quoi créer un nouveau mot de passe entièrement depuis l'extension, sans
  jamais rouvrir le site.

Sur le site comme dans l'extension, un clic sur l'identifiant (icône copier)
le copie, comme un clic sur le mot de passe.

En plus du clic-pour-copier, chaque ligne a un bouton éclair : il remplit le
premier `<input type="password">` visible de la page active et, si le service
a un identifiant, le champ qui s'y apparente juste avant (priorité à
`autocomplete="username"`/`email`, puis `type="email"`, puis un nom/id/placeholder
évocateur ; à défaut, le champ texte du même formulaire). Connexions en deux
étapes (Google, Microsoft…) : sans champ mot de passe, seul l'identifiant est
rempli, et uniquement sur un champ clairement reconnu, jamais une barre de
recherche ; on reclique sur l'éclair à l'étape suivante. Le tout passe par
`chrome.scripting.executeScript`, permission
`activeTab` — pas d'accès permanent à tous les sites visités). Passe par le
setter natif de `HTMLInputElement` puis déclenche un vrai événement `input`
avant/après: sur les sites en React/Vue, une simple assignation
`input.value = ...` est invisible pour le framework et le formulaire semble
rempli mais soumet une valeur vide. Limites assumées (volontairement, pour
rester simple) : le premier champ mot de passe trouvé n'est pas forcément le
bon s'il y en a plusieurs sur la page (ex. formulaire de changement de mot de
passe), et un champ dans une iframe n'est pas vu. Le copier-coller reste le
filet de sécurité dans ces cas, rares en pratique.

**Détection du site actif** (`extension/serviceDetection.js`, module pur testé
sous Node) : l'URL de l'onglet actif (lisible grâce à `activeTab`, sans la
permission `tabs`) est ramenée à son domaine enregistrable (`accounts.google.com`
→ `google.com`, `www.amazon.co.uk` → `amazon.co.uk`, `alice.github.io` reste
tel quel). Dans **Enregistrés**, les services qui correspondent à ce site
(domaine, sous-domaine, URL collée ou nom nu comme `github`) remontent en tête
sous un titre "Sur ce site". Dans **Générateur**, le champ service est
pré-rempli avec ce domaine s'il est vide, avec un indice rappelant qu'il a été
deviné : le service fait partie de la recette du mot de passe, rien n'est donc
jamais changé sans que ce soit visible.

**Se souvenir pendant…** (`extension/masterSession.js`, désactivé par défaut,
5 min / 15 min / 1 h) : on ne garde **jamais le Master Secret**, seulement la
clé HMAC du générateur déjà dérivée par PBKDF2 (le sel du générateur étant
fixe, elle ne dépend que du Master Secret). Si elle fuitait, elle permettrait
de recalculer les mots de passe du générateur, mais ni de retrouver le Master
Secret ni de déchiffrer les secrets `PC2.`. Stockée dans
`chrome.storage.session` (en mémoire uniquement, vidé à la fermeture du
navigateur, inaccessible aux content scripts), avec une expiration absolue
vérifiée à chaque lecture et une alarme (`chrome.alarms` + `background.js`)
qui l'efface à l'échéance même si le popup n'est jamais rouvert. Interface :
un petit menu horloge au bout du champ Master Secret pour choisir la durée ;
une fois la clé mémorisée, une barre de temps restant (orangée la dernière
minute) remplace le texte d'aide, avec un cadenas pour verrouiller tout de
suite. Repasser sur "Non" l'oublie aussi.
Bonus : une seule dérivation PBKDF2 pour toute la liste au lieu d'une par
service.

Architecture : `extension/popup.js` importe
`asset/js/crypto/deterministicPassword.js` et `asset/js/storage/savedServices.js`
depuis `extension/asset/js/...` — une **copie** de ces fichiers (et de
`asset/style/style.css`), pas le fichier original. `extension/storageAdapter.js`
fournit l'adaptateur `chrome.storage.local` ; tout le reste du code (dérivation
de clé, HMAC, mapping vers l'alphabet, normalisation, upsert par
service+identifiant...) est strictement le même que sur le site.

On a d'abord essayé un lien symbolique (`extension/asset -> ../asset`) pour
éviter la duplication — ça résout bien en Node, mais Chrome ne le suit **pas**
quand il sert les fichiers d'une extension non empaquetée : le popup se
chargeait sans CSS ni JS, silencieusement (aucune erreur, juste du HTML brut).
Une vraie copie, régénérée par un script, est plus verbeuse mais fonctionne
partout :

```
npm run sync-extension
```

**À relancer après toute modification** de `asset/js/crypto/`,
`asset/js/storage/` ou `asset/style/style.css`, avant de recharger l'extension
dans le navigateur — sinon elle continue de tourner sur l'ancienne copie.
`extension/asset/` est généré (regénérable à volonté), pas une source de
vérité.

### Installer l'extension en local

1. `npm run sync-extension` (au moins une fois, puis à chaque modif du code
   partagé).
2. `chrome://extensions` (ou l'équivalent Edge/Brave/Firefox) → active le
   "mode développeur".
3. "Charger l'extension non empaquetée" → sélectionne le dossier `extension/`
   (pas la racine du dépôt).
4. Épingle l'icône, ouvre le popup, renseigne ton Master Secret.

## Sécurité de l'interface

Le Master Secret n'est jamais écrit dans `localStorage`/`sessionStorage`, une
URL, ni loggé. Champ `type="password"` avec bascule d'affichage temporaire,
`autocomplete="off"`. Aucune requête vers un serveur tiers : les seules
requêtes réseau sont celles, internes au navigateur, que fait le service
worker pour mettre en cache ses propres fichiers statiques (voir plus bas).

## PWA — installation et hors-ligne

Le site est installable (bouton "Installer" du navigateur, ou "Ajouter à
l'écran d'accueil" sur mobile) et fonctionne hors-ligne une fois visité une
première fois :

- `manifest.webmanifest` déclare le nom, les icônes et le mode `standalone`.
- `sw.js`, servi à la racine (pas dans `asset/js/`) pour que son scope
  couvre toute l'app même si GitHub Pages sert le projet sous un
  sous-chemin, met en cache l'app shell (HTML/CSS/JS/icônes) à l'install et
  sert depuis le cache en priorité, avec revalidation réseau en arrière-plan.
- Les icônes (`asset/icons/*.png`) sont générées par `scripts/generate-icons.mjs`
  (pur Node + zlib, sans dépendance ni outil système comme rsvg-convert) à
  partir des masters `asset/icons/{icon,icon-maskable}.svg` — relance-le si
  tu changes le dessin ou les couleurs de l'icône.

Si tu modifies un fichier mis en cache (JS, CSS...), pense à incrémenter
`CACHE_NAME` dans `sw.js`, sinon les utilisateurs ayant déjà installé l'app
continueront de voir l'ancienne version jusqu'à la revalidation en arrière-plan.
Pendant le développement, active "Update on reload" dans l'onglet Application
> Service Workers des devtools pour éviter de servir du cache périmé.

## Ce que ce n'est pas

Pas un algorithme maison : tout repose sur `crypto.subtle` (PBKDF2, AES-GCM,
HMAC), aucune primitive cryptographique n'est réinventée.

## Tests

```
npm test
```

Lance la suite Node native (`node --test`, zéro dépendance) : aller-retour
chiffrement/déchiffrement, échec sur mauvaise clé ou contenu altéré,
non-déterminisme du chiffrement (deux blobs différents pour le même texte),
déterminisme et isolation du générateur (changer service/identifiant/version
change le résultat), vecteur de test figé pour `generator/v1`, et la liste des
services enregistrés (upsert par service+identifiant, suppression, tri,
tolérance aux données corrompues) via un faux `localStorage` en mémoire.

## Utilisation en local

Ouvre `index.html` dans un navigateur (les modules ES nécessitent un serveur
HTTP, pas `file://` — par exemple `python3 -m http.server` depuis ce
dossier). Aucune installation ni build requis pour faire fonctionner le site
lui-même ; `package.json` ne sert qu'à faire tourner les tests en local.

## Déploiement

Page statique prête pour GitHub Pages : active Pages sur la branche `main`
(dossier racine `/`) dans les paramètres du dépôt, sans configuration
supplémentaire.
