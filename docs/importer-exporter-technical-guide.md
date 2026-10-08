# Guía técnica del importer/exporter de Nightingale

> **Propósito**: explicar cómo funciona técnicamente el sistema de import/export de Nightingale para que pueda re-implementarse en otro proyecto. Cubre los formatos de bundle, los pipelines de exportación e importación, los componentes del escritorio (Tauri/Rust), del backend web (Laravel/PHP), de la SPA web (Vue/TypeScript), y los protocolos de handoff (deep-link, drag-and-drop).
>
> **Audiencia**: ingenieros que van a portar este patrón a otra aplicación, sea una app de escritorio con Tauri o cualquier otro stack que necesite mover "paquetes de canciones" entre una plataforma web y un cliente local.

---

## 0. Contexto: ¿qué es Nightingale y qué se está portando?

**Nightingale** es una aplicación de escritorio (karaoke/análisis de canciones) escrita en Rust + Tauri 2, que guarda canciones en una biblioteca SQLite local (`songs.db`) más artefactos de análisis en una carpeta `cache/` (transcripciones, stems, video reproducible).

**Nightingale Catalog** es el sistema que produce y consume los paquetes de canciones. Consta de tres partes:

| Componente              | Stack                            | Carpeta                                |
| ----------------------- | -------------------------------- | -------------------------------------- |
| Backend web             | PHP 11 + Laravel + Flysystem/R2  | `nightingale-catalog/api/`             |
| SPA web (catálogo)      | Vue 3 + Vite + React-Query       | `nightingale-catalog/web/`             |
| Importer de escritorio  | Tauri 2 (Rust + React/TS)        | `nightingale/client-catalog-importer/` |
| Lógica compartida       | Rust crate `app-core`            | `nightingale/app-core/`                |

El **catalog importer** es una mini-app de escritorio que existe porque la app principal de Nightingale no siempre trae el receptor de URLs profundas (deep-link receiver) instalado. Cuando un usuario encuentra una canción en el catálogo web y pulsa **"Open in Nightingale"**, el navegador dispara una URL `nightingale-import://…` o `nightingale://…`, y *alguno* de los dos Tauri shells la procesa, trae el ZIP y lo aterriza en `songs.db`.

**Lo que se está portando** es este patrón completo: el formato de bundle, el dispatcher de formatos, el ciclo de exportación desde el cliente local, la validación en el servidor, el storage, la firma de URLs, el handshake de deep-link, y el drag-and-drop como vía alternativa.

---

## 1. Diagrama general del flujo

```
┌──────────────┐  buildSlug     ┌─────────────────┐  putZip     ┌────────┐
│ Admin upload │ ───────────▶  │ Laravel + R2    │ ─────────▶ │   R2   │
│ (web admin) │  POST zip     │ ZipValidator    │  songs/... │ bucket │
└──────────────┘              └─────────────────┘             └────┬───┘
                                                                 │ signed URL
                                              POST /download-url │ TTL 5 min
                                              ┌──────────────────▼────┐
                                              │ Vue web SPA           │
                                              │ buildImportDeepLink   │
                                              │   "nightingale-import:│
                                              │    //catalog/v1/import│
                                              │    ?p=<base64url>"    │
                                              └──────────────────┬────┘
                                                                 │ deep-link
                                  ┌──────────────────────────────▼────────┐
                                  │ Tauri importer                          │
                                  │ (com.rzru.catalog-importer)            │
                                  │   deep_link.rs / drag_drop.rs           │
                                  │   ↓                                     │
                                  │  import_catalog_zip(zip_bytes, …)       │
                                  │   ↓                                     │
                                  │  <system_folder>/songs.db   (ProbeOnly) │
                                  │  <library_folder>/<slug>.mp3           │
                                  │  <system_folder>/cache/<hash>_…        │
                                                                 ┌────────────┐
                                                                 │            │
                                  ┌──────────────────────────────▼──────┐     │
                                  │ App principal Nightingale (opcional)│     │
                                  │ client/src-tauri/deep_link.rs        │ ◀───┘ deep-link
                                  │   scheme: "nightingale"              │       alternativo
                                  └──────────────────────────────────────┘
```

Las **dos shells Tauri usan esquemas distintos** pero decodifican el mismo payload:

| Esquema                          | Destino                                  |
| -------------------------------- | ---------------------------------------- |
| `nightingale-import://catalog/v1/import?p=…` | Importer standalone (`client-catalog-importer`) |
| `nightingale://catalog/v1/import?p=…`         | App principal Nightingale (`client`)              |

El payload `p` es un objeto JSON `{url, song_title?, song_id?, source_host?, storage_type?}` codificado en base64url. Sólo `url` es obligatorio.

---

## 2. Los dos formatos de bundle

El sistema soporta dos formatos de paquete ZIP. El dispatcher se basa en el campo `format` dentro de `metadata.json`:

### 2.1 Formato "legacy" (2 entradas)

```
<root>/song.mp3
<root>/metadata.json
```

Donde `root` es un slug `<titulo>-<artista>-<6 caracteres random>`.

El `metadata.json` tiene `schema_version = 1` y **NO** tiene campo `format`:

```json
{
  "schema_version": 1,
  "title": "…",
  "artist": "…",
  "album": "…",
  "genre": null,
  "language": "es",
  "bpm": null,
  "year": null,
  "duration_secs": 215.4,
  "key": "Am",
  "tempo": 120.0,
  "key_offset": 0,
  "cover_url": "https://cdn.example.com/cover.jpg",
  "notes": null,
  "credits": null
}
```

En este formato la portada se descarga **en el importador** desde una URL externa, validada por una lista de hosts permitidos.

### 2.2 Formato "nightingale_song" (rico, embebido)

```
audio.{ext}                                  ← filename declarado en metadata.audio_filename
cover.{ext}                                  ← opcional, cuando metadata.cover_filename está presente
metadata.json                                ← schema_version = 1, format = "nightingale_song"
cache/<file_hash>_transcript.json            ← opcional
cache/<file_hash>_instrumental_<key>_<tempo>.mp3   ← opcional
cache/<file_hash>_vocals_<key>_<tempo>.mp3         ← opcional
cache/<file_hash>_lyrics.json                       ← opcional
cache/playable_videos/<file_hash>.mp4               ← opcional
```

`metadata.json`:

```json
{
  "schema_version": 1,
  "format": "nightingale_song",
  "file_hash": "<blake3 primeros 32 hex>",
  "cover_hash": "<blake3 primeros 32 hex> o \"\">",
  "title": "…",
  "artist": "…",
  "album": "…",
  "duration_secs": 215.4,
  "is_analyzed": true,
  "language": "es",
  "transcript_source": "generated",
  "key": "Am",
  "override_key": null,
  "tempo": 120.0,
  "key_offset": 0,
  "is_video": false,
  "no_stems": false,
  "audio_filename": "audio.mp3",
  "cover_filename": "cover.jpg"
}
```

**Reglas de validación**:

- `audio.{ext}`: el blake3 del archivo debe coincidir con `metadata.file_hash`
- `cover.{ext}`: si existe, blake3 debe coincidir con `metadata.cover_hash`
- Cada entrada bajo `cache/`:
  - Sin zip-slip (rechaza `..` y rutas absolutas)
  - El basename debe empezar por el `file_hash` de la canción (los artefactos son content-addressed)
- `transcript_source` se **normaliza a minúsculas** (`generated`, `lyrics`, `usdx`, `lrc`)

### 2.3 Dispatcher

```rust
// Pseudocódigo
// `.nge` es un ZIP normal: se procesa igual que un `.zip`.
match peek_metadata_format(bytes)?.as_deref() {
    Some("nightingale_song") => import_full_export_zip(...),  // rico, embebido
    _                       => import_catalog_admin_zip(...), // legacy 2-entradas
}
```

La regla es: **`format == "nightingale_song"` → rico, todo lo demás (incluido ausente o `null`) → legacy**. Un `format` con typo (p. ej. `"NightingaleSong"`) cae al path legacy, cuyo validador exige exactamente 2 entradas y rechaza el bundle ruidosamente. **Un typo nunca se traga silenciosamente**.

Un `.nge` no lleva sobre ni cabecera propia: es el mismo ZIP con otra extensión.

---

## 3. Formato `.nge`

Un `.nge` es un **ZIP normal con la extensión cambiada**. No hay cifrado, clave ni cabecera propia: cualquier herramienta de archivos (7-Zip, `unzip`, Archive Utility) puede abrirlo, y eso es aceptable.

Contenido:

```
manifest.json       file_hash, metadata de la canción e índice de entradas (nombre, tamaño, blake3)
instrumental.mp3    una entrada ZIP por archivo del bundle, con el nombre del manifest
vocals.mp3
cover.jpg
transcript.json
video.mp4           opcional
```

Las entradas se guardan sin compresión (`Stored`): audio, video y portada ya vienen comprimidos. Al leer una entrada se verifica su blake3 contra el manifest.

### 3.1 API pública (Rust, `app_core::nge_format`)

```rust
build_nge(file_hash, metadata, entries) -> Result<Vec<u8>, NightingaleError>
NgeFile::open(path) -> Result<NgeFile, NightingaleError>   // lee sólo manifest.json
NgeFile::read_entry(name) -> Result<Vec<u8>, NightingaleError>
```

---

## 4. Pipeline de exportación (cliente local → bundle)

Este pipeline se ejecuta cuando el usuario del importer selecciona canciones ya analizadas y elige exportarlas.

### 4.1 Lectura del origen

```rust
// commands::export_song_zips (Tauri command)
// Para cada file_hash:
let song = load_song_by_hash_for_export(system_folder, file_hash)?;
```

Reglas críticas:

- Se abre una **conexión SQLite fresca** por operación (`MigrateMode::ProbeOnly`, sin singleton).
- Si la fila desapareció entre el listado y la exportación → se emite un evento de error por ZIP y se continúa con el resto.
- Sólo se pueden exportar canciones con `SongOrigin::LocalFile` (las de Jellyfin/Navidrome/Plex requieren un servidor remoto vivo para re-importar).

### 4.2 Construcción del ZIP rico

```rust
// song_export::build_song_export_zip(song, cache) -> Vec<u8>
1. Rechaza si song.origin != LocalFile
2. Lee song.path, calcula blake3, rechaza si no coincide con song.file_hash
3. Lee cover en song.album_art_path; hashea
4. Enumera cache.path, incluye cada archivo cuyo basename empieza por song.file_hash
5. Incluye <cache>/playable_videos/<file_hash>.mp4 si existe
6. Escribe:
   - audio.{ext}       (ext por song.path.ext, fallback mp4 si is_video)
   - cover.{ext}       (si hay cover)
   - metadata.json
   - cada artefacto bajo cache/<basename>
7. Compresión DEFLATE + large_file(true)
```

### 4.3 Extensión `.nge`

```rust
// song_export::build_song_export_nge(song, cache)
// = build_song_export_zip(...) guardado con extensión .nge
```

### 4.4 Escritura

El ZIP se escribe a `<dest_dir>/<slug>.nge`, donde `slug` es `slug_root_folder(title, artist)` (kebab-lowercase ASCII + `-` + 6 caracteres random `[a-z0-9]`). Se emite un evento `export-song-done` con `{ok, fileHash, title, artist, importedPath}` por ZIP. La operación es fire-and-forget en un hilo worker; un fallo individual no aborta el lote.

---

## 5. Pipeline de importación (bundle → cliente local)

Este pipeline se ejecuta en dos lugares:

- **Importer standalone**: `app_core::catalog_import::import_catalog_zip(bytes, system_folder, library_folder, allowed_cover_hosts)`
- **App principal Nightingale**: `app_core::song_export::import_song_export_zip(zip_bytes, target_library_dir, cache)` (sólo acepta el formato rico, sin `.nge`)

### 5.1 Validación común (zip-slip + tamaño)

```rust
MAX_COVER_BYTES = 5 MiB
MAX_ZIP_BYTES   = 64 MiB
MAX_BUNDLE_BYTES = MAX_ZIP_BYTES   // un .nge es un ZIP, sin overhead
```

Cada entrada se valida contra zip-slip:

```rust
fn safe_rel_path(p: &str) -> bool {
    !p.contains("..") && !p.starts_with('/') && !p.starts_with('\\')
}
```

### 5.2 Path legacy (`import_catalog_admin_zip`)

```
1. Validar que el ZIP tiene exactamente 2 entradas bajo un único root folder
2. Parsear metadata.json -> CatalogMetadata
3. Buscar la entrada song.mp3
4. file_hash = blake3_short_hex(audio_bytes)
5. Slug destino: <slug_root_folder(title, artist)>.mp3  -> <library_folder>/
6. download_cover_if_present(metadata.cover_url, allowed_cover_hosts):
     - HTTPS con TLS nativo
     - Host allowlist (soporta *.suffix y prefix.*)
     - Cap 5 MiB
     - Si falla -> importa sin portada (no aborta)
7. upsert_song_compat(...) en songs.db
```

### 5.3 Path rico (`import_full_export_zip`)

```
1. metadata.json presente + format == "nightingale_song" + schema_version == 1
2. file_hash.len() >= 12
3. blake3(audio_bytes) == metadata.file_hash  (rechaza mismatch)
4. blake3(cover_bytes) == metadata.cover_hash  (cuando cover_hash != "")
5. Zip-slip guard en cada entrada de cache/, basename empieza por file_hash
6. Audio -> <library_folder>/<slug>.mp3
7. Cover (si presente) -> <system_folder>/cache/<cover_hash>_cover.jpg (content-addressed)
8. Cada cache entry verbatim
9. upsert_song_compat(...) preservando is_analyzed del metadata
```

### 5.4 Escritura atómica e idempotente

Las funciones `write_audio_if_changed` y `write_content_if_changed`:

- Escriben primero a `.tmp` y luego `rename()` (atómico en Windows y POSIX).
- **Si el destino ya tiene el mismo blake3, no escriben** → re-importar es idempotente.

### 5.5 Escritura en SQLite (`upsert_song_compat`)

El importer **NUNCA** migra la DB del usuario. Para cada fila:

```sql
-- 1. PRAGMA table_info(songs)  →  descubre columnas existentes
-- 2. DELETE FROM songs WHERE file_hash = ?1
-- 3. INSERT INTO songs (<columnas disponibles>) VALUES (...)
```

Esquemas soportados: v0/v1/v2 (12 columnas) y v3 (agrega `genre` y `added_at`). El campo `payload` (TEXT NOT NULL) guarda el `Song` completo como JSON y es la fuente de verdad para la app principal; las otras columnas son una "vista legacy" para el UI web del catálogo.

Todo se ejecuta dentro de una transacción única (`DELETE` + `INSERT`).

### 5.6 Reintentos ante lock

```rust
// catalog_import::retry_sqlite
// Reintenta hasta 3 veces con backoff 250ms / 500ms si SQLite devuelve:
//   - "database is locked"
//   - "database table is locked"
// Otros errores fallan inmediatamente.
```

Necesario porque la app principal Nightingale puede tener un write-lock concurrente sobre `songs.db`.

---

## 6. Schema de la biblioteca local

```sql
CREATE TABLE songs (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    file_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    duration_secs REAL NOT NULL,
    album_art_path TEXT,
    is_analyzed INTEGER NOT NULL,
    language TEXT,
    transcript_source TEXT,
    is_video INTEGER NOT NULL,
    payload TEXT NOT NULL          -- Song completo serializado como JSON
);
-- v3 agrega:
--   genre TEXT,
--   added_at INTEGER NOT NULL DEFAULT 0
```

El struct canónico `Song` (Rust):

```rust
pub struct Song {
    pub path: PathBuf,
    pub file_hash: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: f64,
    pub album_art_path: Option<PathBuf>,
    pub is_analyzed: bool,
    pub language: Option<String>,
    pub transcript_source: Option<TranscriptSource>,
    pub key: Option<String>,
    pub override_key: Option<String>,
    pub tempo: f64,
    pub key_offset: i32,
    pub is_video: bool,
    pub usdx: Option<UsdxBundle>,
    pub origin: SongOrigin,           // LocalFile | Jellyfin | Navidrome | Plex
    pub no_stems: bool,
    pub genre: Option<String>,
    pub added_at: i64,
}
```

`TranscriptSource` enum: `Lyrics | Generated | Usdx | Lrc`. Se serializa en PascalCase en Rust; el catálogo lo normaliza a minúsculas al recibir.

---

## 7. Modos de apertura de SQLite

```rust
pub(super) enum MigrateMode { ProbeOnly, Forward }
```

- **`Forward`** (default de la app principal): corre `configure()` y bumpea `PRAGMA user_version` al actual `SCHEMA_VERSION = 3`, ejecutando `ALTER TABLE` si hace falta.
- **`ProbeOnly`** (importer): corre `configure()` (WAL, foreign_keys, cache_size, mmap_size) y **respeta el `user_version` que ya trae la DB** (v0/v1/v2/v3), nunca promueve.

El importer usa exclusivamente `open_library_db_for_import(system_folder)` que crea `songs.db` si falta, abre en modo `ProbeOnly`, y **NO instala la conexión en el singleton `LIBRARY_DB`**. El caller es responsable de dropear la conexión.

**Regla de oro para el importer**: nunca llamar a `init_library()`. Usar siempre `open_library_db_for_import`.

---

## 8. Cache de artefactos

```rust
CacheDir {
    transcript_path(hash)               → <cache>/<hash>_transcript.json
    instrumental_path(hash)              → <cache>/<hash>_instrumental.mp3
    vocals_path(hash)                    → <cache>/<hash>_vocals.mp3
    variant_instrumental_path(hash, k, t)→ <cache>/<hash>_instrumental_<k>_<t>.mp3
    variant_vocals_path(hash, k, t)      → <cache>/<hash>_vocals_<k>_<t>.mp3
    legacy_instrumental_path(hash)       → <cache>/<hash>_instrumental.ogg
    legacy_vocals_path(hash)             → <cache>/<hash>_vocals.ogg
    lyrics_path(hash)                    → <cache>/<hash>_lyrics.json
    cover_path(hash)                     → <cache>/<hash>_cover.jpg
    playable_video_path(hash)            → <cache>/playable_videos/<hash>.mp4
    transcript_exists(hash)              → transcript + (stems OR no_stems)
    delete_song_cache(hash) / clear_all()
}
```

**Gotcha**: el importer **NO** usa `CacheDir::new()`. Esa función honra `configured_cache_paths()` (lee `~/.nightingale/config.json`), que no es el root correcto para el importer. El importer construye `CacheDir { path: system_folder.join("cache") }` directamente.

---

## 9. Componentes del importer Tauri

### 9.1 Shell Tauri (`src-tauri/src/lib.rs`)

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())       // folder pickers
    .plugin(tauri_plugin_deep_link::init())   // registra nightingale-import://
    .plugin(tauri_plugin_single_instance::init(
        |app, argv, _cwd| { /* foreground window, deep-link forward */ }
    ))                                        // con features=["deep-link"]
    .invoke_handler(tauri::generate_handler![
        commands::read_importer_config,
        commands::write_importer_config,
        commands::list_analyzed_songs,
        commands::export_song_zips,
    ])
    .setup(|app| {
        deep_link::register(app.handle())?;
        drag_drop::register(app.handle())?;
        Ok(())
    })
```

Bundle identifier: `com.rzru.catalog-importer` (debe coincidir con la ruta `%APPDATA%/com.rzru.catalog-importer/config.json`).

Cargo features necesarias para release:
- `tauri/custom-protocol` (sin esto el webview carga localhost:1420 en release y falla silenciosamente)

Plugins:
- `tauri-plugin-deep-link` (registra el scheme)
- `tauri-plugin-single-instance` con `features = ["deep-link"]` (reenvía argv en Windows/Linux)
- `tauri-plugin-dialog` (folder pickers)

### 9.2 Comandos Tauri (`commands.rs`)

Cuatro comandos:

1. **`read_importer_config() -> Option<ImporterConfig>`**
   Lee `%APPDATA%/com.rzru.catalog-importer/config.json`. `None` dispara el wizard de primer arranque en la UI.

2. **`write_importer_config(config) -> Result<(), String>`**
   Valida y persiste. Validación:
   - `system_folder` y `library_folder` deben ser absolutos y distintos
   - En Windows se strippea el prefijo verbatim `\\?\` antes de comparar (`paths_equal`)

3. **`list_analyzed_songs() -> Result<Vec<SongSummary>, String>`**
   Lee config, llama a `app_core::list_analyzed_songs(&cfg.system_folder)`, proyecta a un struct delgado `{fileHash, title, artist, album, durationSecs, isAnalyzed}`. Devuelve `Ok([])` si no hay config (la UI oculta el botón Export).

4. **`export_song_zips(app, file_hashes, dest_dir) -> Result<(), String>`**
   Para cada file_hash abre conexión ProbeOnly, construye ZIP, opcionalmente `.nge`, escribe a `<dest_dir>/<slug>.nge`, emite `export-song-done` por ZIP. Fire-and-forget; errores individuales no abortan el lote.

Eventos emitidos:
- `deep-link-import-done` (compartido con drag-drop)
- `export-song-done`

### 9.3 Drag-and-drop (`drag_drop.rs`)

Se suscribe a `WindowEvent::DragDrop` en la webview principal. En `Drop { paths, .. }`:

1. Foreground de la ventana
2. `pick_bundle(&paths)` acepta la primera entrada con extensión `.zip` o `.nge` (case-insensitive)
3. Si no hay match → emite `deep-link-import-done` con error visible ("drop a .nge or .zip catalog bundle — other file types are ignored")
4. Si hay match:
   - Pre-flight `std::fs::metadata` + size contra `MAX_BUNDLE_BYTES`
   - `std::fs::read` a memoria
   - Gate de config vía `load_importer_config`
   - Llama a `app_core::catalog_import::import_catalog_zip(bytes, system_folder, library_folder, allowed_cover_hosts)`
5. Emite `deep-link-import-done` con el resultado

**El drop path reutiliza el mismo `EVENT_NAME = "deep-link-import-done"` que el path deep-link**, así un único listener en React sirve para ambos.

### 9.4 Deep-link (`deep_link.rs`)

URL: `nightingale-import://catalog/v1/import?p=<base64url(JSON)>`

Payload JSON:
```rust
struct DownloadUrlPayload {
    url: String,           // required
    song_title: Option<String>,
    song_id: Option<String>,
    source_host: Option<String>,
    storage_type: Option<String>,
}
```

`parse_deep_link` es función pura (testeable):
1. `url.scheme() == "nightingale-import"`
2. `url.host_str() == Some("catalog")`
3. `url.path() == "/v1/import"`
4. Query param `p`, decodifica base64url `URL_SAFE_NO_PAD`, `serde_json::from_slice`

`register(app)`:
- `plugin.on_open_url(...)` — warm starts (Apple Event en macOS, argv-forwarded en Windows/Linux)
- `plugin.get_current()` — cold start (URL en argv)

Por cada URL: foreground, parse, spawn worker. El worker:

1. Carga config
2. Crea temp dir en `<system_folder>/deep-link-imports/`
3. Descarga ZIP vía `app_core::http::build_agent` → `agent.get(url).call()` streaming a `import-<nanos>.zip`
4. Lee temp file
5. Borra temp file
6. Llama a `import_catalog_zip(zip_bytes, system_folder, library_folder, allowed_cover_hosts)`
7. Emite `deep-link-import-done`

### 9.5 Configuración (`importer_config.rs`)

```rust
pub struct ImporterConfig {
    pub system_folder: PathBuf,
    pub library_folder: PathBuf,
    #[serde(default = "default_allowed_cover_hosts")]
    pub allowed_cover_hosts: Vec<String>,
}

pub const BUNDLE_ID: &str = "com.rzru.catalog-importer";
pub fn default_config_path() -> PathBuf;  // <dirs::config_dir>/<BUNDLE_ID>/config.json
```

Default allowlist:
```rust
vec!["localhost", "cdn.nightingale-catalog.example.com", "r2.dev", "pub-*.r2.dev"]
```

`host_allowed` soporta dos formas:
- `*.suffix` → wildcard de subdominio
- `prefix.*` → match exacto

El config del importer es **deliberadamente separado** del config de la app principal (`~/.nightingale/config.json`). Ambos coexisten independientemente.

---

## 10. Frontend del importer (React/TypeScript)

### 10.1 Máquina de estados

```ts
type View =
  | { kind: 'loading' }
  | { kind: 'setup'; initial: ImporterConfig }
  | { kind: 'ready'; config: ImporterConfig };

// loading → setup   si readImporterConfig() devuelve null
// loading → ready   si devuelve config
// setup  → ready    cuando SetupWizard llama onSaved
// ready  → setup    cuando el usuario hace click en el gear
```

### 10.2 Bridges IPC

```ts
// bridge/importer-config.ts
type ImporterConfig = { systemFolder: string; libraryFolder: string; allowedCoverHosts: string[] };
readImporterConfig() → invoke<ImporterConfig | null>('read_importer_config');
writeImporterConfig(config) → invoke<void>('write_importer_config', { config });

// bridge/folder-picker.ts
pickFolder(title) → Promise<string | null>;   // tauri-plugin-dialog

// bridge/drag-drop.ts
type DragDropEvent = { type: 'enter'|'over'|'leave' } | { type: 'drop'; paths: readonly string[] };
// Solo feedback visual — el drop se consume en Rust

// bridge/deep-link.ts
type CatalogImportDone = { ok: boolean; fileHash?: string|null; title?: string|null;
                          artist?: string|null; importedPath?: string|null; error?: string|null };
const EVENT_NAME = 'deep-link-import-done';
onDeepLinkImportDone(handler) → listen<CatalogImportDone>(EVENT_NAME, ...);

// bridge/analyzed-songs.ts
type SongSummary = { fileHash: string; title: string; artist: string; album: string;
                     durationSecs: number; isAnalyzed: boolean };
listAnalyzedSongs() → invoke<SongSummary[]>('list_analyzed_songs');
exportSongZips(fileHashes, destDir) → invoke<void>('export_song_zips', { fileHashes, destDir });
```

Conversión camelCase ↔ snake_case: `#[serde(rename_all = "camelCase")]` en Rust + camelCase en TypeScript.

### 10.3 SetupWizard

Dos pasos:

1. Pick system folder (típicamente `%USERPROFILE%/.nightingale`, padre de `songs.db`, `cache/`, etc.)
2. Pick library folder (típicamente `%USERPROFILE%/Music`, donde aterrizan los `.mp3`)

On submit: `writeImporterConfig({systemFolder, libraryFolder, allowedCoverHosts: initial.allowedCoverHosts})`. Validación vive en Rust.

### 10.4 StatusView

Lista los dos folders configurados read-only. Tiene dos listeners:

- `onDeepLinkImportDone` → push fila con `direction: 'import'`
- `listen('export-song-done')` → push fila con `direction: 'export'`

Ambos comparten una lista **Recent imports** (cap 50). Filas fallidas en rojo, exitosas en verde. Exports exitosos muestran el path entre paréntesis.

On mount: si `listAnalyzedSongs()` devuelve no-vacío, muestra el botón **Export your songs…** que abre `ExportSongDialog`.

### 10.5 ExportSongDialog

Multi-select:

1. `listAnalyzedSongs()` → checkbox list
2. Select all / clear
4. "Export N selected…" → `pickFolder("Choose a folder for the exported ZIPs")` → `exportSongZips(fileHashes, destDir)` → cierra el modal (los resultados aparecen por evento en StatusView)

No renderiza resultados propios → batches con fallos parciales no pierden exports exitosos.

---

## 11. Backend Laravel del catálogo

### 11.1 Rutas (`routes/api.php`)

Tres grupos:

- **Públicas** (`throttle:30,1`):
  - `GET /api/songs`
  - `GET /api/songs/{slug}`
  - `POST /api/songs/{song}/download-url`
- **Local fallback** (sólo cuando `R2Storage::isLocalFallback()`):
  - `GET /api/r2-local/{key}`
- **Admin** (`auth:sanctum` + `throttle:60,1`):
  - `POST /api/admin/login` (`throttle:10,1`)
  - `POST /api/admin/logout`, `GET /api/admin/me`
  - `GET /api/admin/songs`, `POST /api/admin/songs`, `POST /api/admin/songs/from-url`
  - `GET /api/admin/songs/{song}`, `PATCH /api/admin/songs/{song}`, `DELETE /api/admin/songs/{song}`
  - `POST /api/admin/songs/{song}/archive`, `POST /api/admin/songs/{song}/unarchive`

### 11.2 `SongController` público

- **`index(Request)`**: filtros `search`, `genre`, `language`, `bpm_min`, `bpm_max`, `key`, `first_letter` (`#` o `A-Z`), paginación (max 50/page), sort.
- **`show($slug)`**: devuelve la canción con `detailed: true`.
- **`downloadUrl(Song)`**: el handoff al deep-link. Devuelve `{ url, song_title, song_id, source_host, storage_type }`. Para R2: URL firmada con TTL 5 min. Para external: `song.zip_url` directo.

### 11.3 `Admin/SongController`

Tres flujos de creación:

1. **`store(Request)`** (multipart, despacha según campo presente):
   - `zip` → `storeFromZip` (acepta tanto rico como legacy, detecta formato por el campo `format` en metadata.json)
   - otro → `storeLegacyMultipart` (acepta `mp3` + `metadata` JSON string + opcional `cover`; el server construye el ZIP legacy via `streamZipToTemp` con `maennchen/zipstream-php`)

2. **`storeFromUrl(Request)`**: body JSON `{zip_url, metadata_overrides?, cover_url?, tags?}`. Fetch con `ExternalUrlFetcher`, valida con `ZipValidator`, hashea, deduplica.

3. **`update`, `destroy`, `archive`, `unarchive`**: CRUD admin estándar.

`buildSlug(title, artist)`: `Str::slug("$title-$artist")` + `-` + 6 chars random. **Nota**: el slug de Laravel produce resultados distintos al `slug_root_folder` de Rust. El sistema los tolera porque cada subsistema usa su propio slug: el importer usa el suyo para el nombre del MP3 en disco, el catálogo usa el suyo para la URL pública.

### 11.4 `ZipValidator`

```php
public const FORMAT_LEGACY = 'legacy';
public const FORMAT_NIGHTINGALE_SONG = 'nightingale_song';

public function validate(string $localZipPath): array
```

Dos pasadas:

**Pasada común**: zip-slip + cap por entry (`catalog.zip_max_bytes`, default 200 MiB) + cap uncompressed total (`catalog.zip_max_uncompressed`, default 400 MiB).

`resolveFormat($metadata)`:
- ausente → `FORMAT_LEGACY`
- `'nightingale_song'` → `FORMAT_NIGHTINGALE_SONG`
- `''` o `'legacy'` → `FORMAT_LEGACY`
- cualquier otra cosa → lanza `InvalidZipException::unsupported_format`

**Path legacy (`inspectLegacy`)**:
- `assertSingleRootFolder`: cada entry bajo un único root folder
- Valida claves metadata: `schema_version, title, artist, album, genre, language, bpm, year, duration_secs, key, tempo, key_offset, cover_url, notes, credits[]`
- Busca `<root>/song.mp3`
- Opcional `<root>/cover.{jpg,jpeg,png}` via `extractOptionalCover`
- Escribe audio a temp via `writeAudioToTemp`

**Path rico (`inspectNightingaleBundle`)**:
- Layout: FLAT (entries en raíz del archivo, `cache/` como único subárbol) o bajo un único subfolder (productores antiguos) — ambas formas aceptadas
- Valida metadata: `schema_version` (=1), `format` (='nightingale_song'), `file_hash` (hex 8-64 chars), `cover_hash` (hex opcional), `title, artist, album, duration_secs, is_analyzed, language, transcript_source, key, override_key, tempo, key_offset, is_video, no_stems, audio_filename, cover_filename`
- Normaliza `transcript_source` a minúsculas
- `audio_filename` debe matchear `^[A-Za-z0-9._-]+$`
- Cover opcional; si `cover_filename` está set debe existir y matchear `[A-Za-z0-9._-]+`

Devuelve:
```php
[
    'format'           => 'legacy' | 'nightingale_song',
    'audio_temp_path'  => string,
    'audio_filename'   => string,
    'audio_size'       => int,
    'metadata'         => array,
    'root'             => string,
    'cover_bytes'      => ?string,
    'cover_extension'  => ?string,
]
```

### 11.5 `R2Storage`

Wrapper Flysystem. Dos modos:

- **S3 (Cloudflare R2)**: producción real. `signedUrl()` genera URLs firmadas con TTL 5 min.
- **Local fallback** (`r2_local` disk): dev. `signedUrl()` devuelve una ruta al `R2LocalDownloadController::download`.

Key naming:
- ZIPs: `songs/<slug>-<sha256[0..12]>.zip`
- Covers: `covers/<sha256>.<ext>`

TTL covers: 1 hora. TTL songs: 5 min (default).

### 11.6 `ExternalUrlFetcher`

Trae un ZIP desde URL externa con:

1. Scheme debe ser `http`/`https`
2. Allowlist por host (sufijo: `mediafire.com` matches `www.mediafire.com` Y `download1480.mediafire.com`, pero rechaza `evilmediafire.com`)
3. HEAD probe para Content-Length
4. Stream-download con byte cap (default 200 MiB) — Guzzle enforce contra Content-Length Y bytes reales recibidos
5. Devuelve `{ local_path, size, source_host, status_code }`

### 11.7 Modelo `Song`

```php
class Song extends Model {
    public const STORAGE_R2       = 'r2';
    public const STORAGE_EXTERNAL = 'external';
    public const FORMAT_LEGACY          = 'legacy';
    public const FORMAT_NIGHTINGALE_SONG = 'nightingale_song';
}
```

`$fillable` incluye: `format, is_analyzed, transcript_source, is_video, no_stems, file_hash, cover_hash, r2_bucket, r2_key, r2_signed_url_ttl, zip_url, source_host, mp3_size_bytes, mp3_sha256, mp3_original_name, cover_url, cover_storage, cover_key`.

Helpers: `isR2()`, `isExternal()`, `coverUrl()` (maneja `cover_storage = 'external' | 'r2' | null`).

---

## 12. SPA web del catálogo

### 12.1 Helpers de deep-link (`lib/nightingale-deep-link.ts`)

```ts
export const utf8ToBase64Url = (input: string): string => {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const buildImportDeepLink = (payload: DownloadUrl): string => {
    const json = JSON.stringify(payload);
    const p = utf8ToBase64Url(json);
    return `nightingale://catalog/v1/import?p=${p}`;
};

export const launchDeepLink = (url: string): void => {
    // crea un <a> oculto, .click(), .remove() en el mismo tick
};
```

**Punto sutil**: usa `nightingale://` (cliente desktop principal). El importer standalone usa `nightingale-import://`. La web necesita dispatch según cuál tenga el usuario instalado (idealmente un setting, o fallback al principal + toast si Nightingale no responde).

**Punto sutil 2**: usa `<a>.click()` en lugar de `window.location.href = …` porque Chrome/Firefox manejan custom schemes inconsistentemente.

### 12.2 Parser ZIP cliente (`song-zip-parser.ts`)

Para auto-rellenar campos en el form de admin antes de submit. Usa `fflate` con la clase `Unzip` de bajo nivel (no la helper `unzip()`).

**Razón crítica**: bundles Nightingale típicamente tienen decenas a cientos de MB (con stems y audio de alto bitrate), y `file.arrayBuffer()` en un Blob de ese tamaño revienta con "Array buffer allocation failed".

Flujo streaming:

```ts
1. new Unzip(cb)
2. unzipper.register(AsyncUnzipInflate)        // entries DEFLATE necesitan el decoder
3. Lee file.stream().getReader() chunk-by-chunk; copia defensiva porque el reader reusa buffer
4. Per-entry filtering: solo entry.start() para metadata.json y la primera imagen;
   cache/* y audio se ignoran (no se llama entry.start(), bytes no se descomprimen)
5. Tras push de todos los bytes con final=true, busca metadata.json en chunkBuffers,
   decode UTF-8, parse JSON
6. format auto-detect: declaredFormat === 'nightingale_song' ? 'nightingale_song' : 'legacy'
7. audio_filename default 'song.mp3' para legacy
8. Cover lookup: si metadata.cover_filename seteado, buscar entry image matching; sino primera entry image

parseSongZip() -> { ok: true, parsed: ParsedBundleMetadata } | { ok: false, error: string }
```

Errores son user-readable: p. ej. "ZIP does not contain a metadata.json entry. Found N entries: …".

### 12.3 Form de admin (`song-form.tsx`)

Dos etapas:

- **Etapa 1**: solo visible la card "Upload bundle"; metadata + credits + submit ocultos
- **Etapa 2**: tras `parseSongZip` exitoso, aparecen las cards de metadata + credits pre-rellenas desde el metadata parseado; admin puede editar; quitar el bundle vuelve a Etapa 1

`metadataToFormPatch(metadata)` extrae `title, artist, album, language, key, tempo, key_offset, cover_url, credits` (no extrae `is_analyzed`, `format`, etc. — esos son concerns server-side).

`CreateSubmitPayload = { kind: 'create'; metadata: {...}; tags: string[]; zip: File }` enviado vía `useCreateSong` al endpoint multipart `/admin/songs`.

### 12.4 `useCreateSong`

```ts
export const useCreateSong = () => {
    const queryClient = useQueryClient();
    return useMutation<Song, Error, CreateSongInput>({
        mutationFn: async ({ metadata, zip, tags }) => {
            const form = new FormData();
            form.append('zip', zip);
            form.append('metadata', JSON.stringify(metadata));
            if (tags !== undefined && tags.length > 0) form.append('tags', tags.join(','));
            const response = await api.postForm<{ data: Song }>('/admin/songs', form);
            return response.data;
        },
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() }),
    });
};
```

### 12.5 Página pública

El botón **Open in Nightingale**:

1. `download.refetch()` para mintear una URL firmada fresca (las URLs de R2 expiran a 5 min)
2. `buildImportDeepLink(fresh.data)` para codificar como `nightingale://catalog/v1/import?p=…`
3. `launchDeepLink(link)` para clickar el anchor oculto
4. `toast.info("If Nightingale didn't open, install the desktop app and try again.", 1500)` — porque los browsers no exponen callback "el OS lanzó el handler"

---

## 13. App principal Nightingale (deep-link receiver alternativo)

La app principal tiene su propio `client/src-tauri/src/deep_link.rs` que:

- Usa scheme `nightingale` (vs `nightingale-import`)
- Mismo host (`catalog`), path (`/v1/import`), `EVENT_NAME = 'deep-link-import-done'`
- Mismo `DownloadUrlPayload`
- Import: `app_core::song_export::import_song_full_from_path(&dest, None)` en lugar de `catalog_import::import_catalog_zip`
- ⇒ **sólo acepta formato rico `nightingale_song`**, sin `.nge`, sin cover download

El exporter del importer produce el formato rico, así que este es el flow intencional.

---

## 14. HTTP y TLS

```rust
// app-core/src/http.rs
pub fn build_agent(
    timeout_connect: Option<Duration>,
    timeout_recv_response: Option<Duration>,
) -> ureq::Agent
```

Configuración crítica para Windows:
```toml
ureq = { version = "3", default-features = false, features = ["json", "native-tls"] }
let agent = ureq::AgentBuilder::new()
    .tls_config(
        ureq::tls::TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build()
    )
    .build();
```

**Por qué importa**: en Windows con Avast (o cualquier MITM proxy) instalado, `rustls` rechaza los certs. Usar `TlsProvider::NativeTls` + `RootCerts::PlatformVerifier` delega la validación al OS (schannel), que sí confía en los certs MITMed por Avast.

Si re-implementas esto en otro proyecto que descargue HTTPS desde una app de escritorio en Windows, usa la misma combinación o tendrás problemas similares.

---

## 15. Consideraciones de seguridad

### 15.1 Zip-slip

Toda entrada del ZIP se valida antes de escribir:

```rust
fn safe_rel_path(p: &str) -> bool {
    !p.contains("..") && !p.starts_with('/') && !p.starts_with('\\')
}
```

Y en el path rico, además: el basename debe empezar por el `file_hash` (content-addressed), así entradas `cache/../../etc/passwd` se rechazan tanto por zip-slip como por mismatch de prefijo.

### 15.2 Hash verification

- Audio: blake3 del archivo debe coincidir con `metadata.file_hash`
- Cover: blake3 debe coincidir con `metadata.cover_hash` (cuando no esté vacío)
- Hash format: blake3 primeros 32 chars hex (16 bytes / 128 bits)

### 15.3 Size caps (defense-in-depth)

- Cover: 5 MiB
- ZIP: 64 MiB
- Bundle con `.nge`: 64 MiB + 38 bytes

### 15.4 Host allowlist (cover URL legacy)

```rust
vec!["localhost", "cdn.nightingale-catalog.example.com", "r2.dev", "pub-*.r2.dev"]
```

Soporta:
- `*.suffix` → wildcard de subdominio
- `prefix.*` → match exacto

`host_allowed` está en `catalog_import.rs`. La versión PHP está en `ExternalUrlFetcher`.

### 15.5 `.nge` no está protegido

Un `.nge` es un ZIP renombrado, sin cifrado. Cualquiera puede abrirlo con 7-Zip o `unzip`; es intencional.

### 15.6 Singleton SQLite y ProbeOnly

El importer **nunca** llama a `init_library()`. Usa exclusivamente `open_library_db_for_import` que:
- Crea `songs.db` si no existe
- Abre con `MigrateMode::ProbeOnly` (no migra)
- NO instala en el singleton `LIBRARY_DB`

Esto evita lock contention con la app principal y significa que la DB del usuario no es tocada más allá de upsert.

---

## 16. Guía de implementación para otro proyecto

### 16.1 Decisiones de diseño que tienes que tomar

1. **¿Legacy o sólo rico?**
   - Si sólo soportas el formato rico, tu código se simplifica mucho (no hay cover download, no hay validación de root folder, no hay dual-dispatch).
   - Si soportas ambos, necesitas el dispatcher en `import_catalog_zip` y `ZipValidator`.

2. **¿`.nge` o no?**
   - Es opcional. Sin él, los bundles son ZIPs normales que cualquiera puede inspeccionar.
   - Úsalo si quieres desalentar exploradores casuales pero no necesitas secreto real.

3. **¿Deep-link, drag-drop, ambos?**
   - Deep-link requiere un handler Tauri (`tauri-plugin-deep-link`) y un scheme registrado.
   - Drag-drop sólo requiere el listener `WindowEvent::DragDrop`.
   - Ambos paths pueden compartir el mismo evento React (`deep-link-import-done`).

4. **¿Storage R2 o local?**
   - R2 (o S3) con signed URLs es ideal: el ZIP vive en storage público, la URL expirada limita el acceso.
   - Local funciona para dev pero no escala.

### 16.2 Checklist mínima de portabilidad

Componentes mínimos para tener un sistema funcional end-to-end:

- [ ] **Definir los formatos de bundle** (al menos uno) con un `metadata.json` con `schema_version` y opcionalmente `format`
- [ ] **Implementar el dispatcher** (si hay más de un formato): `peek_metadata_format` → `match format`
- [ ] **Validaciones de trust**:
  - [ ] Zip-slip guard en cada entry
  - [ ] Hash verification (audio, cover)
  - [ ] Cap por entry (5 MiB cover, 64 MiB total) — defensa contra zip-bombs
  - [ ] Host allowlist para cualquier cover URL externa
- [ ] **SQLite write strategy**:
  - [ ] Probar `PRAGMA table_info(songs)` y hacer INSERT dinámico de las columnas presentes
  - [ ] `DELETE BY hash` + `INSERT` en una transacción
  - [ ] Retry on `SQLITE_BUSY` / `SQLITE_LOCKED` (3×, 250ms backoff)
  - [ ] **Nunca migrar la DB del usuario** (usar `ProbeOnly`)
- [ ] **Atomic file writes**: write a `.tmp` + `rename`. Skip si destination ya tiene mismo blake3 (idempotente)
- [ ] **Web SPA**: client-side ZIP preview streaming (NO `arrayBuffer()` en blobs grandes), multipart upload, deep-link handoff con `<a>.click()`
- [ ] **Tauri shell** (si aplica):
  - [ ] `tauri-plugin-deep-link` con scheme registrado
  - [ ] `tauri-plugin-single-instance` con `features = ["deep-link"]`
  - [ ] Cargo feature `tauri/custom-protocol` para release
  - [ ] Foreground window en warm starts
- [ ] **Deep-link URL**: `<scheme>://<host>/<path>?p=<base64url(JSON payload)>`. Payload: `{url, ...metadata opcional}`
- [ ] **HTTP TLS** en Windows: `TlsProvider::NativeTls` + `RootCerts::PlatformVerifier` (sobrevive MITM proxies)

### 16.3 Lo que NO tienes que replicar

- El envelope `.nge` (opcional, ya discutido)
- El formato legacy 2-entradas (si vas a arrancar limpio, usa sólo el rico)
- Los slugs idénticos entre sistemas (cada subsistema usa el suyo; no intentes hacerlos match)
- El bundle identifier `com.rzru.catalog-importer` (usa el de tu app)

### 16.4 Estructura de proyecto sugerida

```
mi-proyecto/
├── core/                    # Rust crate con la lógica compartida
│   ├── importer_config.rs
│   ├── bundle_format.rs     # dispatcher + validación
│   ├── bundle_writer.rs     # build_song_export_zip
│   ├── bundle_reader.rs     # extract_song_export_zip
│   ├── cover_envelope.rs    # .nge opcional
│   ├── library_db/          # conexión ProbeOnly
│   └── http.rs              # build_agent con NativeTls
├── desktop-importer/        # Tauri shell
│   ├── src-tauri/
│   │   ├── commands.rs
│   │   ├── deep_link.rs
│   │   ├── drag_drop.rs
│   │   └── lib.rs
│   └── src/                 # React/TS UI
└── catalog-backend/         # Laravel/Rails/lo que uses
    ├── routes/
    ├── controllers/
    └── validators/          # ZipValidator equivalente
```

### 16.5 Test fixtures útiles

Nightingale incluye fixtures de ejemplo en `nightingale/client-catalog-importer/example/` (p. ej. `Make-You-Smile-44.zip`). Si vas a re-implementar, créate fixtures para:

- Un bundle legacy válido
- Un bundle rico válido
- Un bundle rico con hash de audio incorrecto (debe rechazarse)
- Un bundle rico con zip-slip en cache (debe rechazarse)
- Un bundle rico con cover faltante pero `cover_hash` no vacío (debe rechazarse)
- Un `.nge` válido (envoltorio + ZIP)
- Un `.zip` que NO es bundle (debe rechazarse o ignorarse según diseño)

---

## 17. Resumen de endpoints / comandos / eventos

### Tauri commands (importer)

| Command                    | Input                              | Output                  |
| -------------------------- | ---------------------------------- | ----------------------- |
| `read_importer_config`     | -                                  | `Option<ImporterConfig>` |
| `write_importer_config`    | `ImporterConfig`                   | `Result<(), String>`    |
| `list_analyzed_songs`      | -                                  | `Result<Vec<SongSummary>, String>` |
| `export_song_zips`         | `file_hashes: Vec<String>, dest_dir: String` | `Result<(), String>` |

### Eventos Tauri (importer)

| Evento                   | Payload | Disparado por |
| ------------------------ | -------- | ------------ |
| `deep-link-import-done`  | `CatalogImportDone` | deep-link path, drag-drop path |
| `export-song-done`       | `CatalogImportDone` | export_song_zips (uno por ZIP) |

### HTTP endpoints (catálogo)

| Método | Ruta                                       | Auth         | Propósito |
| ------ | ------------------------------------------ | ------------ | --------- |
| GET    | `/api/songs`                               | -            | Listado público con filtros |
| GET    | `/api/songs/{slug}`                        | -            | Detalle público |
| POST   | `/api/songs/{song}/download-url`           | -            | Mintea signed URL (TTL 5 min) |
| GET    | `/api/r2-local/{key}`                      | -            | Local fallback download |
| POST   | `/api/admin/login`                         | -            | Login admin |
| POST   | `/api/admin/logout`                        | sanctum      | Logout admin |
| GET    | `/api/admin/me`                            | -                 | Sesión actual |
| GET    | `/api/admin/songs`                         | sanctum      | Listado admin |
| POST   | `/api/admin/songs`                         | sanctum      | Upload (multipart: zip+metadata+tags) |
| POST   | `/api/admin/songs/from-url`                | sanctum      | Import por URL externa |
| GET    | `/api/admin/songs/{song}`                  | sanctum      | Detalle admin |
| PATCH  | `/api/admin/songs/{song}`                  | sanctum      | Update admin |
| DELETE | `/api/admin/songs/{song}`                  | sanctum      | Delete admin |
| POST   | `/api/admin/songs/{song}/archive`         | sanctum      | Archivar |
| POST   | `/api/admin/songs/{song}/unarchive`       | sanctum      | Desarchivar |

---

## 18. Apéndice: paths completos en el repo Nightingale

Por si quieres ir a leer el código fuente real:

**Tauri shell (importer)**:
- `nightingale/client-catalog-importer/src-tauri/Cargo.toml`
- `nightingale/client-catalog-importer/src-tauri/tauri.conf.json`
- `nightingale/client-catalog-importer/src-tauri/src/main.rs`
- `nightingale/client-catalog-importer/src-tauri/src/lib.rs`
- `nightingale/client-catalog-importer/src-tauri/src/commands.rs`
- `nightingale/client-catalog-importer/src-tauri/src/drag_drop.rs`
- `nightingale/client-catalog-importer/src-tauri/src/deep_link.rs`
- `nightingale/client-catalog-importer/src-tauri/src/logging.rs`

**Frontend (importer)**:
- `nightingale/client-catalog-importer/src/main.tsx`
- `nightingale/client-catalog-importer/src/App.tsx`
- `nightingale/client-catalog-importer/src/bridge/importer-config.ts`
- `nightingale/client-catalog-importer/src/bridge/folder-picker.ts`
- `nightingale/client-catalog-importer/src/bridge/drag-drop.ts`
- `nightingale/client-catalog-importer/src/bridge/deep-link.ts`
- `nightingale/client-catalog-importer/src/bridge/analyzed-songs.ts`
- `nightingale/client-catalog-importer/src/components/SetupWizard.tsx`
- `nightingale/client-catalog-importer/src/components/StatusView.tsx`
- `nightingale/client-catalog-importer/src/components/ExportSongDialog.tsx`

**Lógica compartida (app-core)**:
- `nightingale/app-core/src/lib.rs`
- `nightingale/app-core/src/importer_config.rs`
- `nightingale/app-core/src/catalog_import.rs`
- `nightingale/app-core/src/catalog_export.rs`
- `nightingale/app-core/src/song_export.rs`
- `nightingale/app-core/src/nge_format.rs`
- `nightingale/app-core/src/http.rs`
- `nightingale/app-core/src/cache.rs`
- `nightingale/app-core/src/song.rs`
- `nightingale/app-core/src/library_db/mod.rs`
- `nightingale/app-core/src/library_db/connection.rs`
- `nightingale/app-core/src/library_db/migrations.rs`
- `nightingale/app-core/src/library_db/songs.rs`

**Tauri shell (app principal)**:
- `nightingale/client/src-tauri/src/lib.rs`
- `nightingale/client/src-tauri/src/deep_link.rs`
- `nightingale/client/src-tauri/src/song_export.rs`
- `nightingale/client/src-tauri/src/catalog_export.rs`

**Catalog web SPA**:
- `nightingale-catalog/web/src/lib/nightingale-deep-link.ts`
- `nightingale-catalog/web/src/lib/download.ts`
- `nightingale-catalog/web/src/features/songs/components/song-zip-parser.ts`
- `nightingale-catalog/web/src/features/songs/components/song-form.tsx`
- `nightingale-catalog/web/src/features/songs/mutations/use-create-song.ts`
- `nightingale-catalog/web/src/features/catalog/components/song-detail-public.tsx`
- `nightingale-catalog/web/src/features/catalog/components/song-row-public.tsx`
- `nightingale-catalog/web/src/features/catalog/components/public-catalog-page.tsx`

**Catalog API**:
- `nightingale-catalog/api/routes/api.php`
- `nightingale-catalog/api/app/Http/Controllers/SongController.php` (público)
- `nightingale-catalog/api/app/Http/Controllers/Admin/SongController.php`
- `nightingale-catalog/api/app/Http/Controllers/R2LocalDownloadController.php`
- `nightingale-catalog/api/app/Support/ZipValidator.php`
- `nightingale-catalog/api/app/Support/R2Storage.php`
- `nightingale-catalog/api/app/Support/ExternalUrlFetcher.php`
- `nightingale-catalog/api/app/Support/InvalidZipException.php`
- `nightingale-catalog/api/app/Models/Song.php`