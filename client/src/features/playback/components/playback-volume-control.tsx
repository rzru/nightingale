import { Volume2Icon } from 'lucide-react';

import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { t } from '@/i18n';
import type { AppConfig } from '@/types/AppConfig';

export function PlaybackVolumeControl({ config }: { config: AppConfig | null }) {
  const { masterVolume } = usePlaybackTransportState();
  const { setMasterVolume } = usePlaybackTransportActions();
  const persistConfig = usePlaybackConfigPersist(config);
  const commitVolume = (value: string) => persistConfig({ master_volume: Number(value) / 100 });

  return (
    <div className="pointer-events-auto mt-1.5 flex h-[64px] w-[28px] shrink-0 flex-col items-center text-white/55 [@media(any-pointer:coarse)]:w-[44px]">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(masterVolume * 100)}
        aria-label={t('settings.masterVolume')}
        aria-valuetext={`${Math.round(masterVolume * 100)}%`}
        onInput={(event) => setMasterVolume(Number(event.currentTarget.value) / 100)}
        onPointerUp={(event) => commitVolume(event.currentTarget.value)}
        onPointerCancel={(event) => commitVolume(event.currentTarget.value)}
        onKeyUp={(event) => commitVolume(event.currentTarget.value)}
        onBlur={(event) => commitVolume(event.currentTarget.value)}
        className="volume-slider min-h-0 flex-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3ead7]"
      />
      <Volume2Icon
        className="mt-1 size-[16px] shrink-0 [@media(any-pointer:coarse)]:size-[22px]"
        aria-hidden="true"
        strokeWidth={1.75}
      />
    </div>
  );
}
