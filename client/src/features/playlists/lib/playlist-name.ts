import { SEARCH_PLAYLIST_ID } from '@/bridge/accounts';
import { t } from '@/i18n';

/** Display name of an imported playlist; the search history has a translated one. */
export const wishPlaylistName = (playlist: { id: string; name: string }): string =>
  playlist.id === SEARCH_PLAYLIST_ID ? t('playlists.search.playlistName') : playlist.name;
