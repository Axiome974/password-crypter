# Password Crypter

Petit outil 100 % vanilla (HTML/CSS/JS, sans dépendance) pour générer un mot de
passe unique et reproductible à partir d'une clé secrète — et retrouver
l'original à l'inverse, avec la même clé.

## Comment ça marche

Chaque caractère du mot de passe est XORé (au niveau de son index dans un
alphabet de 64 caractères) avec le caractère correspondant de la clé, répétée
en boucle. Le XOR étant sa propre opération inverse, chiffrer et déchiffrer
utilisent exactement le même calcul : les deux champs se recalculent l'un
l'autre en direct, quel que soit celui que tu modifies.

⚠️ C'est un outil ludique de mémorisation, pas un algorithme de chiffrement
robuste — ne t'en sers pas pour protéger un vrai secret sensible.

## Utilisation en local

Ouvre simplement `index.html` dans un navigateur, aucune installation ni build
requis.

## Déploiement

Le projet est une page statique prête pour GitHub Pages : active Pages sur la
branche `main` (dossier racine `/`) dans les paramètres du dépôt, sans
configuration supplémentaire.
