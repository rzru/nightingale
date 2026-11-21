# Comptes YouTube et « Envies » (fork)

Cette branche ajoute la liaison d'un compte YouTube et l'import de ses
playlists comme « envies » : les titres que tu veux chanter, qu'ils soient déjà
dans ta bibliothèque ou non.

## 1. Créer le client OAuth Google (une seule fois)

1. <https://console.cloud.google.com/> → créer un projet (ex. `nightingale-karaoke`).
2. **API et services → Bibliothèque** → activer **YouTube Data API v3**.
3. **Écran de consentement OAuth** → type *Externe*, statut *Test*, ajoute ton
   adresse Gmail dans *Utilisateurs test*. Scope : `.../auth/youtube.readonly`.
4. **Identifiants → Créer → ID client OAuth** → type **Application de bureau**.
5. Copie l'ID client et le code secret dans un fichier `.env` à la racine du
   dépôt (déjà ignoré par git) :

   ```env
   YOUTUBE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   YOUTUBE_CLIENT_SECRET=GOCSPX-xxxxxxxx
   ```

   `app-core/build.rs` les intègre au binaire à la compilation. À défaut, ils
   sont lus dans l'environnement au lancement.

En mode *Test*, Google invalide le jeton de rafraîchissement au bout de 7 jours :
il faut alors reconnecter le compte. Passer l'application en *Production* lève
cette limite (vérification Google nécessaire pour un usage public).

## 2. Comment ça marche

- **Connexion** : `youtube_begin_auth` ouvre un écouteur sur `127.0.0.1:<port
  aléatoire>` et renvoie l'URL de consentement Google (OAuth + PKCE, RFC 8252).
  L'interface ouvre l'URL dans le navigateur, puis interroge
  `account_poll_auth` jusqu'au statut `authorized`.
- **Stockage** : `accounts.json` à côté de `config.json`. Les jetons sont
  chiffrés avec la même enveloppe que les mots de passe Jellyfin/Navidrome
  (`secret.rs`), ce qui marche aussi en auto-hébergé et dans Docker.
- **Envies** : `wishes_import_youtube_playlist` stocke les titres (titre,
  artiste, durée, URL) dans `songs.db` (tables `wishes`, `wish_playlists`,
  `wish_playlist_items`, schéma v3). Ensuite, chaque envie est rapprochée de la
  bibliothèque : même artiste principal et même titre (sans accents ni
  parenthèses), à ±10 s près.
  Statuts : `missing` (à télécharger), `available` (présent), `ready` (analysé).
  La correspondance est recalculée après chaque scan.

## 3. Téléchargement (« Tout préparer »)

- `wishes_prepare_playlist` (ou `wishes_prepare` pour des titres choisis) :
  - titres `missing` → file de téléchargement yt-dlp, un à la fois, vers
    `<dossier de musique>/YouTube/Artiste - Titre [id].m4a` (pochette et tags
    inclus) ;
  - titres `available` → analyse directement.
- Après le lot (et tous les 10 fichiers), un scan ajoute les fichiers à la
  bibliothèque. Chaque envie est reliée à son fichier par son chemin, puis son
  analyse est lancée automatiquement. Les statuts `analyzing`, `ready` et
  `failed` suivent la file d'analyse.
- **Outils** : au premier téléchargement, Nightingale installe dans son propre
  environnement Python `yt-dlp[default]` (qui contient `yt-dlp-ejs`) et `deno`,
  le moteur JavaScript que YouTube exige depuis yt-dlp 2025.11. Les deux sont
  remis à jour tous les 3 jours au plus. Rien n'est installé sur le système.
- Ne marche qu'avec une bibliothèque de type **dossier** : Nightingale n'écrit
  pas dans Plex, Jellyfin ni Navidrome.
- Un téléchargement interrompu par la fermeture de l'application revient en
  `missing` au démarrage suivant.

## 4. Commandes disponibles (`client/src/bridge/accounts.ts`)

| Commande | Rôle |
| --- | --- |
| `accounts_overview` | comptes liés + YouTube configuré ou non |
| `youtube_begin_auth` / `account_poll_auth` / `account_cancel_auth` | connexion |
| `account_unlink` | déconnexion + révocation chez Google |
| `youtube_list_playlists` | playlists de l'utilisateur (+ « J'aime », id `liked`) |
| `wishes_import_youtube_playlist` | importer / réimporter une playlist |
| `wishes_list_playlists` / `wishes_load_playlist` / `wishes_delete_playlist` | consulter |
| `wishes_refresh_matches` | relancer la correspondance avec la bibliothèque |
| `wishes_prepare_playlist` / `wishes_prepare` | tout préparer / préparer une sélection |
| `wishes_downloader_status` / `wishes_cancel_downloads` | suivre / arrêter les téléchargements |

Événements émis : `accounts-changed`, `wishes-changed`.

## 5. Suite prévue

1. Écran « Mes playlists » avec le statut par titre et « Tout préparer ».
2. Spotify (même module `accounts/oauth.rs`, client PKCE sans secret).

## Vérifier la branche

```bash
cargo fmt --all --check
cargo clippy -p app-core -p app-api --all-targets -- -D warnings
cargo test -p app-core accounts wishes   # régénère aussi client/src/types/*.ts
pnpm --dir client quality
```
