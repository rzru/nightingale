import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from '@/app/app';
import { getMediaEndpoint } from '@/bridge/playback.tauri';
import { isTauri } from '@/bridge/runtime';
import { webBootstrapSchema } from '@/bridge/schemas';

document.addEventListener('contextmenu', (e) => e.preventDefault());

/**
 * Tauri injects `window.__NIGHTINGALE_*` ahead of script execution via the
 * main webview's `initialization_script`; dynamically created webviews fetch
 * the media endpoint before React mounts. The web target gets its payload from
 * `/api/bootstrap` and also seeds the globals before mounting.
 */
async function loadBootstrap(): Promise<void> {
  if (isTauri) {
    if (!window.__NIGHTINGALE_MEDIA_ENDPOINT__) {
      try {
        window.__NIGHTINGALE_MEDIA_ENDPOINT__ = await getMediaEndpoint();
      } catch {}
    }
    return;
  }

  try {
    const res = await fetch('/api/bootstrap');
    if (!res.ok) {
      return;
    }
    const data: unknown = await res.json();
    const bootstrap = webBootstrapSchema.parse(data);
    window.__NIGHTINGALE_APP_CONFIG__ = bootstrap.config;
    window.__NIGHTINGALE_SONGS_META__ = bootstrap.songsMeta;
    window.__NIGHTINGALE_SERVER_FLAGS__ = {
      dataPathPinned: Boolean(bootstrap.dataPathPinned),
      libraryPinned: Boolean(bootstrap.libraryPinned),
    };
  } catch {}
}

void loadBootstrap().then(() => {
  const root = document.getElementById('root');
  if (root === null) {
    throw new Error('Missing application root');
  }
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  return undefined;
});
