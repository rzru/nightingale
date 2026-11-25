import { Music2Icon, Volume2Icon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { t } from '@/i18n';
import type { AppConfig } from '@/types/AppConfig';

import { HudSetting, HudSettingValue, ShortcutKeys } from './playback-hud-setting';

function VolumeSlider({
  label,
  icon,
  shortcut,
  expanded,
  volume,
  onVolumeChange,
  onVolumeCommit,
}: {
  label: string;
  icon: LucideIcon;
  shortcut?: ReactNode;
  expanded: boolean;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onVolumeCommit: (volume: number) => void;
}) {
  const percent = Math.round(volume * 100);
  const commit = (value: string) => onVolumeCommit(Number(value) / 100);

  return (
    <HudSetting
      icon={icon}
      label={label}
      trailing={<HudSettingValue>{percent}%</HudSettingValue>}
      shortcut={shortcut}
    >
      {expanded && (
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
      )}
    </HudSetting>
  );
}

export function PlaybackVolumeControl({
  config,
  showShortcuts,
  expanded,
}: {
  config: AppConfig | null;
  showShortcuts: boolean;
  expanded: boolean;
}) {
  const { masterVolume, guideVolume, guideAvailable } = usePlaybackTransportState();
  const { setMasterVolume, setGuideVolume } = usePlaybackTransportActions();
  const persistConfig = usePlaybackConfigPersist(config);

  return (
    <>
      <VolumeSlider
        icon={Volume2Icon}
        label={t('settings.masterVolume')}
        shortcut={showShortcuts ? <ShortcutKeys keys={['[', ']']} /> : undefined}
        expanded={expanded}
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
          shortcut={showShortcuts ? <ShortcutKeys keys={['G', '-', '+']} /> : undefined}
          expanded={expanded}
          volume={guideVolume}
          onVolumeChange={setGuideVolume}
          onVolumeCommit={(volume) =>
            persistConfig({ guide_volume: volume, master_volume: masterVolume })
          }
        />
      )}
    </>
  );
}
