# Scan Retours — version serveur (Node + PostgreSQL)

Application de scan de colis retour : lecture du code-barres, photo automatique nette, horodatage, le tout stocké dans une base PostgreSQL et consultable depuis n'importe quel téléphone.

## Ce qu'il y a dans le projet

```
colis-app/
├─ server.js          → le serveur (API + base)
├─ package.json       → dépendances
├─ public/
│  └─ index.html      → la page scanner (caméra + recherche)
└─ README.md          → ce fichier
```

## Déployer sur Railway (pas à pas)

1. Crée un compte sur railway.app (connexion avec GitHub conseillée).
2. Mets ce dossier `colis-app` dans un dépôt **GitHub** (le plus simple : nouveau dépôt, glisse les fichiers).
3. Sur Railway : **New Project → Deploy from GitHub repo**, choisis ton dépôt.
4. Toujours dans le projet Railway : **New → Database → Add PostgreSQL**.
   Railway crée la base et fournit automatiquement la variable `DATABASE_URL` au service.
5. Vérifie que le service web « voit » la base : dans les **Variables** du service web,
   `DATABASE_URL` doit être présent. Si besoin, ajoute-le en référence :
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
6. Railway construit et démarre tout seul (`npm install` puis `npm start`).
7. Dans **Settings → Networking → Generate Domain**, génère une adresse publique
   du type `https://xxxx.up.railway.app`.
8. Ouvre cette adresse **https://** sur ton iPhone → autorise la caméra → c'est prêt.
   Ajoute-la à l'écran d'accueil (Partager → Sur l'écran d'accueil) pour l'avoir comme une appli.

> La table de la base est créée automatiquement au premier démarrage. Rien à faire à la main.

## Variables d'environnement

| Variable       | Qui la fournit            | Rôle                                              |
|----------------|---------------------------|---------------------------------------------------|
| `DATABASE_URL` | module PostgreSQL Railway | connexion à la base (obligatoire)                 |
| `PORT`         | Railway                   | port d'écoute (auto)                              |
| `PGSSL`        | toi, seulement si besoin  | mets `true` si tu utilises l'URL **publique** de la base |

## Tester en local (facultatif)

Avec un PostgreSQL en local :

```bash
npm install
export DATABASE_URL="postgresql://USER:PASS@localhost:5432/colis"
npm start
# puis ouvre http://localhost:3000  (la caméra marche aussi sur localhost)
```

## API (pour info)

| Méthode | Route                    | Rôle                                  |
|---------|--------------------------|---------------------------------------|
| POST    | `/api/scans`             | enregistre un colis (code + photo)    |
| GET     | `/api/scans?q=...`       | liste / recherche (renvoie le total)  |
| GET     | `/api/scans/:id/image`   | renvoie la photo                      |
| PUT     | `/api/scans/:id`         | corrige le code                       |
| DELETE  | `/api/scans/:id`         | supprime un colis                     |
| DELETE  | `/api/scans`             | vide tout                             |
| GET     | `/api/export.csv`        | export CSV                            |

## Bon à savoir

- **Accès libre** : toute personne ayant l'adresse peut voir et ajouter des colis.
  Si un jour tu veux un mot de passe, c'est une petite modification à ajouter — demande.
- **Stockage** : les photos sont dans PostgreSQL (colonne binaire). Parfait jusqu'à
  quelques milliers de photos. Au-delà, on pourra basculer vers un stockage de fichiers
  dédié (volume Railway / Cloudflare R2 / S3) sans tout refaire.
- **Recherche** : insensible aux espaces et à la casse. Tape les chiffres sous le
  code-barres avec ou sans espaces, ça retrouve le colis. Un bout suffit (ex. `250H`).
