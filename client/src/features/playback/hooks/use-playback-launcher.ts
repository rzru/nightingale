import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import {
  reservePlaybackTarget,
  savePlaybackSession,
  showPlaybackTarget,
  type PlaybackSession,
  type PlaybackTarget,
} from '@/bridge/playback-session';
import { t } from '@/i18n';
import { useConfig } from '@/shared/config/use-config';

export function usePlaybackLauncher() {
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const sessionMode = config?.playback_mode === 'session';

  const reserveTarget = useCallback((): PlaybackTarget => {
    const target = sessionMode ? reservePlaybackTarget() : null;
    if (target === undefined) {
      toast.error(t('playback.hooks.usePlaybackLauncher.allowPopUpsToOpenDescription'));
    }
    return target;
  }, [sessionMode]);

  const launch = useCallback(
    async (session: PlaybackSession, target: PlaybackTarget): Promise<void> => {
      try {
        if (!sessionMode) {
          await navigate('/playback', { replace: session.queuePlayback, state: session });
          return;
        }

        await savePlaybackSession(session);
        await showPlaybackTarget(target);
      } catch (error) {
        target?.close();
        toast.error(
          t('playback.usePlaybackLauncher.couldNotStartPlayback', {
            value1: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
    [navigate, sessionMode],
  );

  return { launch, reserveTarget, sessionMode };
}
