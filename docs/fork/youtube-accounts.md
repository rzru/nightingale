# Comptes YouTube et « Envies » (fork)

Cette branche ajoute la liaison d'un compte YouTube et l'import de ses
playlists comme « envies » : les titres que tu veux chanter, qu'ils soient déjà
dans ta bibliothèque ou non.

## 1. Connexion : « Utiliser ma session YouTube »

Aucune configuration : pas de projet Google Cloud, pas de clé.

1. Dans « Mes playlists », clique sur **Utiliser ma session YouTube**.
2. Nightingale détecte le navigateur par défaut du système
   (`xdg-settings` sous Linux, LaunchServices sous macOS, registre sous
   Windows), installe yt-dlp si besoin, puis vérifie si ce navigateur est déjà
   connecté à YouTube (`--cookies-from-browser`, en lisant les « J'aime »).
3. Si ce n'est pas le cas, la page de connexion YouTube s'ouvre dans le
   navigateur. Tu te connectes, puis tu cliques sur **J'ai terminé**.
4. Seul le nom du navigateur est enregistré (`accounts.json`), jamais de
   cookie ni de mot de passe. Les cookies sont relus à chaque lecture de
   playlist.

Limites connues :
- **Firefox** est le plus fiable. Sous Windows, Chrome, Edge et Brave
  (Chrome 127+) chiffrent leurs cookies par application, ce qui empêche yt-dlp
  de les lire : choisis alors Firefox dans la liste.
- La liste des « J'aime » renvoyée par yt-dlp est parfois incomplète (bug
  connu de pagination côté YouTube).
- Les téléchargements eux-mêmes restent anonymes, sans cookies, pour limiter
  le risque de blocage du compte.

### Option avancée : OAuth Google

Le flux OAuth (`accounts/oauth.rs`, `youtube_begin_auth`) reste dans le code,
mais l'interface ne l'affiche plus. Il demande un client OAuth Google
(`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` dans `.env`).

## 2. Comment ça marche

- **Lecture des playlists** : yt-dlp en mode métadonnées
  (`--dump-single-json --flat-playlist`) sur `feed/playlists` et
  `playlist?list=LL`, avec la session du navigateur.
- **Envies** : `wishes_import_youtube_playlist` stocke les titres (titre,
  artiste, durée, URL) dans `songs.db` (tables `wishes`, `wish_playlists`,
  `wish_playlist_items`). Chaque envie est ensuite rapprochée de la
  bibliothèque : même artiste principal et même titre (sans accents ni
  parenthèses), à ±10 s près. La correspondance est recalculée après chaque
  scan et chaque analyse.

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
| `youtube_session_begin` / `youtube_session_connect` | connexion par la session du navigateur |
| `youtube_begin_auth` / `account_poll_auth` / `account_cancel_auth` | connexion OAuth (option avancée) |
| `account_unlink` | déconnexion (+ révocation chez Google en OAuth) |
| `youtube_list_playlists` | playlists de l'utilisateur (+ « J'aime », id `liked`) |
| `wishes_import_youtube_playlist` | importer / réimporter une playlist |
| `wishes_list_playlists` / `wishes_load_playlist` / `wishes_delete_playlist` | consulter |
| `wishes_refresh_matches` | relancer la correspondance avec la bibliothèque |
| `wishes_prepare_playlist` / `wishes_prepare` | tout préparer / préparer une sélection |
| `wishes_downloader_status` / `wishes_cancel_downloads` | suivre / arrêter les téléchargements |

Événements émis : `accounts-changed`, `wishes-changed`.

## 5. Écran « Mes playlists »

Accessible depuis le menu du profil (en bas de la barre latérale), à côté de
« Paramètres ». Code : `client/src/features/playlists/`.

- Carte **Compte YouTube** : connexion, attente de l'accord dans le navigateur
  (avec « Rouvrir » et « Annuler »), déconnexion. Un message s'affiche si le
  client OAuth n'est pas configuré.
- **Tes playlists YouTube** : « J'aime » en premier, puis tes playlists, avec
  « Importer » ou « Mettre à jour ».
- **Playlists importées** et leur détail : statut par titre, barre de
  progression pendant le téléchargement, erreurs, boutons « Préparer » ou
  « Réessayer » par titre, et « Tout préparer ».
- Bandeau du téléchargeur : installation de yt-dlp, nombre de titres en
  cours, bouton « Arrêter ».
- Traductions : en, fr, de, zh-cn (clés `playlists.*`).

Pas encore géré : la navigation à la manette et au clavier, que les autres
écrans gèrent avec `useMenuFocus`.

## 6. Suite prévue

1. Navigation manette/clavier sur l'écran « Mes playlists ».
2. Spotify (même module `accounts/oauth.rs`, client PKCE sans secret).

## Vérifier la branche

```bash
cargo fmt --all --check
cargo clippy -p app-core -p app-api --all-targets -- -D warnings
cargo test -p app-core accounts wishes   # régénère aussi client/src/types/*.ts
pnpm --dir client quality
```
