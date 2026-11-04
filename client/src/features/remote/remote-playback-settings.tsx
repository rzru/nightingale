import { ChevronDownIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useState } from 'react';

import type { PlaybackControl, PlaybackOptions } from '@/bridge/playback-remote';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/shared/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Slider } from '@/shared/components/ui/slider';
import { cn } from '@/shared/utils/cn';

const GUIDE_MIN = 0;
const GUIDE_MAX = 100;
const GUIDE_STEP = 5;

// Toggle state reads from the label; the button itself stays secondary and small.
const TOGGLE_CLASS = 'h-9 px-3 text-xs aria-pressed:bg-accent aria-pressed:text-accent-foreground';

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function GuideControl({
  options,
  onControl,
}: {
  options: PlaybackOptions;
  onControl: (control: PlaybackControl) => void;
}) {
  // Radix fires on every drag pixel; the host persists on commit only. The
  // draft remembers the host value it was based on, so the next host snapshot
  // replaces it without an effect.
  const [draft, setDraft] = useState<{ percent: number; base: number } | null>(null);
  const percent =
    draft !== null && draft.base === options.guideVolume
      ? draft.percent
      : Math.round(options.guideVolume * GUIDE_MAX);

  return (
    <ControlRow label={t('playback.hud.guidePercent', { percent })}>
      <Slider
        className="py-3.5 [&_[data-slot=slider-thumb]]:size-5"
        min={GUIDE_MIN}
        max={GUIDE_MAX}
        step={GUIDE_STEP}
        value={[percent]}
        aria-label={t('remote.queue.guide')}
        onValueChange={(value) =>
          setDraft({ percent: value[0] ?? GUIDE_MIN, base: options.guideVolume })
        }
        onValueCommit={(value) =>
          onControl({ type: 'set-guide-volume', volume: (value[0] ?? GUIDE_MIN) / GUIDE_MAX })
        }
      />
    </ControlRow>
  );
}

function MicControl({
  options,
  onControl,
}: {
  options: PlaybackOptions;
  onControl: (control: PlaybackControl) => void;
}) {
  return (
    <ControlRow label={t('settings.microphone.label')}>
      <div className="flex min-w-0 items-center gap-2">
        <Select
          value={options.selectedMicId ?? undefined}
          onValueChange={(deviceId) => onControl({ type: 'select-mic', deviceId })}
        >
          <SelectTrigger className="h-12 min-w-0 flex-1 text-sm">
            <SelectValue placeholder={t('settings.microphone.default')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.microphones.map((microphone) => (
                <SelectItem key={microphone.deviceId} value={microphone.deviceId}>
                  {microphone.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className={TOGGLE_CLASS}
          aria-pressed={options.micEnabled}
          onClick={() => onControl({ type: 'toggle-mic' })}
        >
          {t(options.micEnabled ? 'playback.hud.micOff' : 'playback.hud.micOn')}
        </Button>
      </div>
    </ControlRow>
  );
}

type RemotePlaybackSettingsProps = {
  options: PlaybackOptions;
  onControl: (control: PlaybackControl) => void;
};

/**
 * Playback settings for the phone. Everything here is a request to the host's
 * playback surface, which owns the audio engine and persists the change.
 */
export function RemotePlaybackSettings({ options, onControl }: RemotePlaybackSettingsProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col">
      {/* Above the trigger so the panel unfolds towards the queue, away from
          the thumb reaching for the slider. */}
      {/* Scrolls instead of pushing the seek bar and action row off a short
          screen; the trigger stays put below it. */}
      <CollapsibleContent className="grid max-h-[45dvh] grid-cols-1 gap-4 overflow-x-hidden overflow-y-auto overscroll-contain pb-3">
        {options.guideAvailable ? <GuideControl options={options} onControl={onControl} /> : null}

        {options.multiplayer ? null : <MicControl options={options} onControl={onControl} />}

        <ControlRow label={t('remote.queue.monitoring')}>
          <Button
            variant="outline"
            className={TOGGLE_CLASS}
            aria-pressed={options.micMonitorEnabled}
            onClick={() => onControl({ type: 'toggle-monitoring' })}
          >
            {t(options.micMonitorEnabled ? 'playback.hud.monitorOff' : 'playback.hud.monitorOn')}
          </Button>
        </ControlRow>

        <ControlRow label={t('playback.playbackHud.theme')}>
          <Select
            value={options.themeKey}
            onValueChange={(key) => onControl({ type: 'select-theme', key })}
          >
            <SelectTrigger className="h-12 w-full min-w-0 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.themes.map((theme) => (
                  <SelectItem key={theme.key} value={theme.key}>
                    {theme.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </ControlRow>

        <ControlRow label={t('playback.playbackHud.flavor')}>
          <Select
            value={options.flavorKey}
            disabled={!options.flavorAvailable}
            onValueChange={(key) => onControl({ type: 'select-flavor', key })}
          >
            <SelectTrigger className="h-12 w-full min-w-0 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.flavors.map((flavor) => (
                  <SelectItem key={flavor.key} value={flavor.key}>
                    {flavor.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </ControlRow>
      </CollapsibleContent>

      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="h-11 w-full justify-between px-3 text-sm text-muted-foreground"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
            {t('remote.queue.settings')}
          </span>
          <ChevronDownIcon
            className={cn('size-4 transition-transform', !open && 'rotate-180')}
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
    </Collapsible>
  );
}
