import { useEffect, useMemo, useState } from 'react';

import { useMicDevicesQuery, type MicDevice } from '@/features/microphone/queries/use-mic-devices';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Field } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { Slider } from '@/shared/components/ui/slider';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import type { AppConfig } from '@/types/AppConfig';

import { NAV } from './constants';
import { MicLatencyField } from './mic-latency-field';
import { MicTestField } from './mic-test-field';
import { Hint, SettingsSelect } from './settings-controls';

const DEFAULT_MIC_ID = '__default__';

type MicrophoneSettingsProps = {
  savedMicId: string | null;
  combineMultiChannel: boolean;
  monitorGain: number;
  latencySec: number;
  getFocusClassName: (segment: number, slot?: number) => string;
  onMonitorGainChange: (gain: number) => void;
  onLatencyChange: (latencySec: number) => void;
};

const microphoneOptions = (devices: MicDevice[], preferred: string | null) => {
  const options = [
    { value: DEFAULT_MIC_ID, label: 'Default' },
    ...devices.map(({ deviceId, label }) => ({ value: deviceId, label })),
  ];
  if (preferred !== null && !options.some((option) => option.value === preferred)) {
    options.push({ value: preferred, label: `Selected microphone: ${preferred}` });
  }
  return options;
};

type MicDevicesQuery = ReturnType<typeof useMicDevicesQuery>;

const microphoneDiscoveryHint = (query: MicDevicesQuery): string => {
  if (query.isError) {
    const detail = query.error instanceof Error ? query.error.message : String(query.error);
    return `Could not list microphones: ${detail}`;
  }
  if (query.isFetching) {
    return 'Looking for available microphones…';
  }
  return 'Select which microphone to use for pitch scoring';
};

const MicrophoneRetryButton = ({ query }: { query: MicDevicesQuery }) => {
  if (!query.isError) {
    return null;
  }
  return (
    <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
      Retry microphone discovery
    </Button>
  );
};

const useLegacyMicrophoneMigration = (
  preferred: string | null,
  devices: MicDevice[],
  mutate: (config: Partial<AppConfig>) => void,
): void => {
  useEffect(() => {
    if (preferred === null) {
      return;
    }
    const legacyMatch = devices.find(
      (device) => device.name === preferred && device.deviceId !== preferred,
    );
    if (legacyMatch) {
      mutate({ preferred_mic: legacyMatch.deviceId });
    }
  }, [devices, mutate, preferred]);
};

export function MicrophoneSettings({
  savedMicId,
  combineMultiChannel,
  monitorGain,
  latencySec,
  getFocusClassName,
  onMonitorGainChange,
  onLatencyChange,
}: MicrophoneSettingsProps) {
  const { mutate } = useConfigMutation();
  const micDevicesQuery = useMicDevicesQuery(undefined, true, combineMultiChannel);
  const micDevices = micDevicesQuery.data;
  const [preferredMicInput, setPreferredMic] = useState<string | null | undefined>(undefined);
  const preferredMic = preferredMicInput === undefined ? savedMicId : preferredMicInput;
  const [micTestBusy, setMicTestBusy] = useState(false);
  const [latencyMeasuring, setLatencyMeasuring] = useState(false);
  const micOptions = useMemo(
    () => microphoneOptions(micDevices, preferredMic),
    [micDevices, preferredMic],
  );
  const monitorGainPct = Math.round(monitorGain * 100);
  const controlsDisabled = micTestBusy || latencyMeasuring;

  useLegacyMicrophoneMigration(preferredMic, micDevices, mutate);

  return (
    <>
      <Field>
        <Label>Microphone</Label>
        <Label className="gap-1.5 text-xs/relaxed font-normal text-muted-foreground">
          <Checkbox
            checked={combineMultiChannel}
            className={getFocusClassName(NAV.general.microphone, 0)}
            onCheckedChange={(checked) => mutate({ combine_multi_channel: checked === true })}
          />
          Combine multi-channel
        </Label>
        <Hint>{microphoneDiscoveryHint(micDevicesQuery)}</Hint>
        <SettingsSelect
          label="Microphone"
          placeholder="Default microphone"
          value={preferredMic ?? DEFAULT_MIC_ID}
          options={micOptions}
          disabled={controlsDisabled}
          triggerClassName={getFocusClassName(NAV.general.microphone, 1)}
          onValueChange={(value) => {
            const next = value === DEFAULT_MIC_ID ? null : value;
            setPreferredMic(next);
            mutate({ preferred_mic: next });
          }}
        />
        <MicrophoneRetryButton query={micDevicesQuery} />
      </Field>

      <Field>
        <Label>Mic monitor gain</Label>
        <Hint>
          Volume of your microphone played back through the speakers while monitoring (
          {monitorGainPct}%)
        </Hint>
        <Slider
          min={0}
          max={200}
          step={1}
          value={[monitorGainPct]}
          onValueChange={([pct]) => onMonitorGainChange(pct / 100)}
          className={getFocusClassName(NAV.general.micMonitorGain)}
        />
      </Field>

      <MicLatencyField
        selectedMicId={preferredMic}
        latencySec={latencySec}
        disabled={micTestBusy}
        sliderClassName={getFocusClassName(NAV.general.micLatency, 0)}
        buttonClassName={getFocusClassName(NAV.general.micLatency, 1)}
        onMeasuringChange={setLatencyMeasuring}
        onLatencyChange={onLatencyChange}
      />

      <MicTestField
        selectedMicId={preferredMic}
        disabled={latencyMeasuring}
        startButtonClassName={getFocusClassName(NAV.general.micTest, 0)}
        playButtonClassName={getFocusClassName(NAV.general.micTest, 1)}
        onBusyChange={setMicTestBusy}
        onCaptureStarted={() => void micDevicesQuery.refetch()}
      />
    </>
  );
}
