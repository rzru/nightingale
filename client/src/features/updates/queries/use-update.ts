import { useQuery } from '@tanstack/react-query';
import { type Update } from '@tauri-apps/plugin-updater';

import { UPDATE_CHANNEL, UPDATES_SUPPORTED, type UpdateChannel } from '@/bridge/platform';
import { checkForUpdate } from '@/bridge/updater';
import { t } from '@/i18n';
import { UPDATER } from '@/shared/query-keys';

/**
 * The `"unsupported"` variant carries the reason so the dialog can render
 * targeted copy (Linux-Tauri vs self-hosted web). Every other variant only
 * matters in the auto-update path and stays byte-identical to the Tauri
 * non-Linux behaviour so the `availableView` / `checkingView` / `errorView`
 * branches keep narrowing the way they do today.
 */
export type UnsupportedChannel = Exclude<UpdateChannel, 'auto'>;

export type UpdateState =
  | { status: 'unsupported'; channel: UnsupportedChannel }
  | { status: 'checking' }
  | { status: 'error'; error: Error; isOffline: boolean }
  | { status: 'up-to-date' }
  | { status: 'available'; update: Update };

export type UpdateStatus = UpdateState['status'];

const isOfflineError = (error: Error): boolean => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }

  const msg = error.message.toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('dns') ||
    msg.includes('getaddrinfo') ||
    msg.includes('connect') ||
    msg.includes('timed out')
  );
};

const buildState = (query: {
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  data: Update | null | undefined;
  error: unknown;
}): UpdateState => {
  if (!UPDATES_SUPPORTED) {
    // The `auto` channel is the only one where `UPDATES_SUPPORTED` is true,
    // so anything left over here is necessarily one of the unsupported
    // channels. Narrow explicitly so the dialog can switch on it.
    const channel: UnsupportedChannel =
      UPDATE_CHANNEL === 'self-hosted-web' ? 'self-hosted-web' : 'linux-tauri';
    return { status: 'unsupported', channel };
  }

  if (query.isLoading || query.isFetching) {
    return { status: 'checking' };
  }

  if (query.isError) {
    const error =
      query.error instanceof Error ? query.error : new Error(t('common.errors.unknown'));

    return { status: 'error', error, isOffline: isOfflineError(error) };
  }

  if (query.data) {
    return { status: 'available', update: query.data };
  }

  return { status: 'up-to-date' };
};

export const useUpdate = () => {
  const query = useQuery({
    queryKey: UPDATER,
    queryFn: checkForUpdate,
    staleTime: Infinity,
    cacheTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: UPDATES_SUPPORTED,
  });

  return { ...buildState(query), refetch: query.refetch };
};
