import { useEffect, useMemo, useState } from 'react';

import { useMicDevicesQuery, type MicDevice } from '@/features/microphone/queries/use-mic-devices';
import { t } from '@/i18n';
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
  onMultiChannelAvailabilityChange: (available: boolean) => void;
  onMonitorGainChange: (gain: number) => void;
  onLatencyChange: (latencySec: number) => void;
};

const microphoneOptions = (devices: MicDevice[], preferred: string | null) => {
  const options = [
    { value: DEFAULT_MIC_ID, label: 'settings.microphoneSettings.default' },
    ...devices.map(({ deviceId, label }) => ({ value: deviceId, label })),
  ];
  if (preferred !== null && !options.some((option) => option.value === preferred)) {
    options.push({
      value: preferred,
      label: t('settings.microphone.selected', { id: preferred }),
    });
  }
  return options;
};

type MicDevicesQuery = ReturnType<typeof useMicDevicesQuery>;

const microphoneDiscoveryHint = (query: MicDevicesQuery): string => {
  if (query.isError) {
    const detail = query.error instanceof Error ? query.error.message : String(query.error);
    return t('settings.microphone.listError', { error: detail });
  }
  if (query.isFetching) {
    return t('settings.microphone.searching');
  }
  return t('settings.microphone.description');
};

const MicrophoneRetryButton = ({ query }: { query: MicDevicesQuery }) => {
  if (!query.isError) {
    return null;
  }
  return (
    <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
      {t('settings.microphoneSettings.retryMicrophoneDiscovery')}
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
  onMultiChannelAvailabilityChange,
  onMonitorGainChange,
  onLatencyChange,
}: MicrophoneSettingsProps) {
  const { mutate } = useConfigMutation();
  const micDevicesQuery = useMicDevicesQuery(undefined, true, combineMultiChannel);
  const capabilityQuery = useMicDevicesQuery(undefined, !combineMultiChannel, true);
  const micDevices = micDevicesQuery.data;
  const capabilityDevices = combineMultiChannel ? micDevices : capabilityQuery.data;
  const hasMultiChannelInput = capabilityDevices.some((device) => device.channelCount > 1);
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
  useEffect(() => {
    onMultiChannelAvailabilityChange(hasMultiChannelInput);
  }, [hasMultiChannelInput, onMultiChannelAvailabilityChange]);

  return (
    <>
      <Field>
        <Label>{t('settings.microphoneSettings.microphone')}</Label>
        {hasMultiChannelInput ? (
          <Label className="gap-1.5 text-xs/relaxed font-normal text-muted-foreground">
            <Checkbox
              checked={combineMultiChannel}
              className={getFocusClassName(NAV.general.microphone, 0)}
              onCheckedChange={(checked) => mutate({ combine_multi_channel: checked === true })}
            />
            {t('settings.microphoneSettings.combineMultiChannel')}
          </Label>
        ) : null}
        <Hint>{microphoneDiscoveryHint(micDevicesQuery)}</Hint>
        <SettingsSelect
          label={t('settings.microphoneSettings.microphone')}
          placeholder={t('settings.microphoneSettings.defaultMicrophone')}
          value={preferredMic ?? DEFAULT_MIC_ID}
          options={micOptions}
          disabled={controlsDisabled}
          triggerClassName={getFocusClassName(NAV.general.microphone, hasMultiChannelInput ? 1 : 0)}
          onValueChange={(value) => {
            const next = value === DEFAULT_MIC_ID ? null : value;
            setPreferredMic(next);
            mutate({ preferred_mic: next });
          }}
        />
        <MicrophoneRetryButton query={micDevicesQuery} />
      </Field>

      <Field>
        <Label>{t('settings.microphoneSettings.micMonitorGain')}</Label>
        <Hint>
          {t('settings.microphoneSettings.volumeOfYourMicrophonePlayedDescription', {
            value1: monitorGainPct,
          })}
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
