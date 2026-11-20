import { Music2Icon, Volume2Icon, type LucideIcon } from 'lucide-react';

import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { t } from '@/i18n';
import type { AppConfig } from '@/types/AppConfig';

function VolumeSlider({
  icon: Icon,
  label,
  shortcut,
  volume,
  onVolumeChange,
  onVolumeCommit,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onVolumeCommit: (volume: number) => void;
}) {
  const percent = Math.round(volume * 100);
  const commit = (value: string) => onVolumeCommit(Number(value) / 100);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 text-xs text-white/60">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon className="size-4 shrink-0" aria-hidden="true" strokeWidth={1.75} />
          <span className="truncate">{label}</span>
          {shortcut !== undefined && <span className="shrink-0 text-white/40">{shortcut}</span>}
        </span>
        <span className="shrink-0 tabular-nums">{percent}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label={label}
        aria-valuetext={`${percent}%`}
        onInput={(event) => onVolumeChange(Number(event.currentTarget.value) / 100)}
        onPointerUp={(event) => commit(event.currentTarget.value)}
        onPointerCancel={(event) => commit(event.currentTarget.value)}
        onKeyUp={(event) => commit(event.currentTarget.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        className="seek-slider block h-[14px] w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3ead7] [@media(any-pointer:coarse)]:h-[24px]"
      />
    </div>
  );
}

export function PlaybackVolumeControl({
  config,
  showShortcuts,
}: {
  config: AppConfig | null;
  showShortcuts: boolean;
}) {
  const { masterVolume, guideVolume, guideAvailable } = usePlaybackTransportState();
  const { setMasterVolume, setGuideVolume } = usePlaybackTransportActions();
  const persistConfig = usePlaybackConfigPersist(config);

  return (
    <div className="flex w-56 flex-col gap-2 text-white/70">
      <VolumeSlider
        icon={Volume2Icon}
        label={t('settings.masterVolume')}
        shortcut={showShortcuts ? '[ / ]' : undefined}
        volume={masterVolume}
        onVolumeChange={setMasterVolume}
        onVolumeCommit={(volume) =>
          persistConfig({ master_volume: volume, guide_volume: guideVolume })
        }
      />
      {guideAvailable && (
        <VolumeSlider
          icon={Music2Icon}
          label={t('remote.queue.guide')}
          shortcut={showShortcuts ? 'G +/-' : undefined}
          volume={guideVolume}
          onVolumeChange={setGuideVolume}
          onVolumeCommit={(volume) =>
            persistConfig({ guide_volume: volume, master_volume: masterVolume })
          }
        />
      )}
    </div>
  );
}
