/// <reference types="vite/client" />

import type { ServerFlags } from './bridge/server-flags';
import type { AppConfig } from './types/AppConfig';
import type { MediaEndpoint } from './types/MediaEndpoint';
import type { SongsMeta } from './types/SongsMeta';

declare global {
  interface Window {
    __NIGHTINGALE_APP_CONFIG__?: AppConfig;
    __NIGHTINGALE_INITIAL_DEEP_LINK__?: string | null;
    __NIGHTINGALE_MEDIA_ENDPOINT__?: MediaEndpoint;
    __NIGHTINGALE_SERVER_FLAGS__?: ServerFlags;
    __NIGHTINGALE_SONGS_META__?: SongsMeta;
    webkitAudioContext?: typeof AudioContext;
  }
}
