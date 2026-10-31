import { convertFileSrc as tauriConvertFileSrc } from '@tauri-apps/api/core';

import { isTauri } from './runtime';

/**
 * Desktop uses the authenticated local media server because WebKit blocks
 * `asset://` URLs from Vite's HTTP origin. Self-hosted web uses its same-origin
 * asset route. Both servers canonicalise paths against the allowed media roots.
 */
export const convertFileSrc = (path: string): string => {
  if (!path) {
    return '';
  }
  if (isTauri) {
    const endpoint = window.__NIGHTINGALE_MEDIA_ENDPOINT__;
    if (endpoint) {
      const { port, session_token } = endpoint;
      return `http://127.0.0.1:${port}/s/${session_token}/local/${encodeURIComponent(path)}`;
    }
    return tauriConvertFileSrc(path);
  }
  return `/api/asset?path=${encodeURIComponent(path)}`;
};
