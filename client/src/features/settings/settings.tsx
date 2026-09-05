import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { setFullScreen, isFullScreen as tauriIsFullScreen } from '@/bridge/fullScreen';
import { selectRecordingsFolder } from '@/bridge/recording';
import { clampPlaybackScale } from '@/features/playback/lib/display-scale';
import {
  ALIGN_BACKENDS,
  ASR_ENGINES,
  DEFAULTS,
  LYRICS_HORIZONTAL_POSITIONS,
  LYRICS_VERTICAL_POSITIONS,
  MODELS,
  NAV,
  PLAYBACK_MODES,
  PLAYBACK_SCALE_MAX,
  PLAYBACK_SCALE_MIN,
  PLAYBACK_SCALE_STEP,
  SEPARATORS,
  SETTINGS_TABS,
  VOCAL_THRESHOLD_MAX,
  getAnalysisNav,
  type SettingsTab,
} from '@/features/settings/components/constants';
import { MicrophoneSettings } from '@/features/settings/components/microphone-settings';
import { PlaybackPreview } from '@/features/settings/components/playback-preview';
import {
  Hint,
  NumberButtonGroup,
  PageHeader,
  SettingsSelect,
} from '@/features/settings/components/settings-controls';
import { useSettingsNavigation } from '@/features/settings/hooks/use-settings-navigation';
import { Button } from '@/shared/components/ui/button';
import { ButtonGroup } from '@/shared/components/ui/button-group';
import { Field, FieldGroup } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Slider } from '@/shared/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import type { AppConfig } from '@/types/AppConfig';

const generalSettings = (config: AppConfig | undefined) => {
  if (!config) {
    return {
      fullscreen: undefined,
      preferredMic: null,
      micMonitorGain: DEFAULTS.mic_monitor_gain,
      micLatency: DEFAULTS.mic_latency_compensation_sec,
    };
  }

  return {
    fullscreen: config.fullscreen,
    preferredMic: config.preferred_mic,
    micMonitorGain: config.mic_monitor_gain ?? DEFAULTS.mic_monitor_gain,
    micLatency: config.mic_latency_compensation_sec ?? DEFAULTS.mic_latency_compensation_sec,
  };
};

const recordingsPath = (config: AppConfig | undefined): string | null =>
  config?.recordings_path ?? null;

const recordingsFolderButtonLabel = (path: string | null): string => {
  return path === null || path === '' ? 'Choose Folder' : 'Change Folder';
};

const playbackSettings = (config: AppConfig | undefined) => ({
  mode: config?.playback_mode ?? DEFAULTS.playback_mode,
  lyricsVertical: config?.lyrics_vertical_position ?? DEFAULTS.lyrics_vertical_position,
  lyricsHorizontal: config?.lyrics_horizontal_position ?? DEFAULTS.lyrics_horizontal_position,
  lyricsScale: clampPlaybackScale(config?.lyrics_scale),
  pitchGraphScale: clampPlaybackScale(config?.pitch_graph_scale),
  recordingsPath: recordingsPath(config),
});

const pendingValue = <T,>(input: T | null, saved: T): T => input ?? saved;

const analysisSettings = (config: AppConfig | undefined) => {
  if (!config) {
    return {
      asrEngine: DEFAULTS.asr_engine,
      separator: DEFAULTS.separator,
      whisperModel: DEFAULTS.whisper_model,
      beamSize: DEFAULTS.beam_size,
      alignBackend: DEFAULTS.align_backend,
      autoAnalyze: DEFAULTS.auto_analyze,
      batchSize: DEFAULTS.batch_size,
      vocalThreshold: DEFAULTS.vocal_detection_threshold_pct,
    };
  }

  return {
    asrEngine: config.asr_engine ?? DEFAULTS.asr_engine,
    separator: config.separator ?? DEFAULTS.separator,
    whisperModel: config.whisper_model ?? DEFAULTS.whisper_model,
    beamSize: config.beam_size ?? DEFAULTS.beam_size,
    alignBackend: config.align_backend ?? DEFAULTS.align_backend,
    autoAnalyze: config.auto_analyze === true,
    batchSize: config.batch_size ?? DEFAULTS.batch_size,
    vocalThreshold: config.vocal_detection_threshold_pct ?? DEFAULTS.vocal_detection_threshold_pct,
  };
};

const isSettingsTab = (value: string): value is SettingsTab =>
  SETTINGS_TABS.some((tab) => tab.value === value);

const chooseRecordingsFolder = async (save: (patch: Partial<AppConfig>) => void) => {
  try {
    const recordings_path = await selectRecordingsFolder();
    if (typeof recordings_path === 'string' && recordings_path !== '') {
      save({ recordings_path });
    }
  } catch (error) {
    toast.error(
      `Could not choose recordings folder: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const SettingsPage = () => {
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();

  const containerRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SettingsTab>('general');
  const general = generalSettings(config);
  const playback = playbackSettings(config);
  const analysis = analysisSettings(config);
  const [isFullScreen, setIsFullScreen] = useState<boolean | null | undefined>(general.fullscreen);
  const [micMonitorGainInput, setMicMonitorGain] = useState<number | null>(null);
  const micMonitorGain = micMonitorGainInput ?? general.micMonitorGain;
  const [micLatencySecInput, setMicLatencySec] = useState<number | null>(null);
  const micLatencySec = micLatencySecInput ?? general.micLatency;
  const [lyricsVerticalInput, setLyricsVertical] = useState<string | null>(null);
  const lyricsVertical = pendingValue(lyricsVerticalInput, playback.lyricsVertical);
  const [lyricsHorizontalInput, setLyricsHorizontal] = useState<string | null>(null);
  const lyricsHorizontal = pendingValue(lyricsHorizontalInput, playback.lyricsHorizontal);
  const [lyricsScaleInput, setLyricsScale] = useState<number | null>(null);
  const lyricsScale = pendingValue(lyricsScaleInput, playback.lyricsScale);
  const [pitchGraphScaleInput, setPitchGraphScale] = useState<number | null>(null);
  const pitchGraphScale = pendingValue(pitchGraphScaleInput, playback.pitchGraphScale);
  const [vocalThresholdPctInput, setVocalThresholdPct] = useState<number | null>(null);
  const vocalThresholdPct = vocalThresholdPctInput ?? analysis.vocalThreshold;

  const close = (): void => {
    void navigate('/');
  };
  const asrEngine = analysis.asrEngine;
  const isParakeet = asrEngine === 'parakeet';
  const analysisNav = getAnalysisNav(isParakeet);

  const modelOptions = useMemo(() => MODELS.map((model) => ({ value: model, label: model })), []);
  const lyricsScalePct = Math.round(lyricsScale * 100);
  const pitchGraphScalePct = Math.round(pitchGraphScale * 100);
  const vocalThresholdDisplayPct = Math.round(vocalThresholdPct * 100);
  const batchSize = analysis.batchSize;
  const beamSize = analysis.beamSize;

  useEffect(() => {
    const updateIsFullScreen = async () => {
      setIsFullScreen(await tauriIsFullScreen());
    };

    void updateIsFullScreen();
  }, []);

  const updateMicMonitorGain = (gain: number) => {
    setMicMonitorGain(gain);
    mutate({ mic_monitor_gain: gain });
  };

  const updateMicLatency = (latencySec: number) => {
    setMicLatencySec(latencySec);
    mutate({ mic_latency_compensation_sec: latencySec });
  };

  const updateLyricsScale = (scale: number) => {
    setLyricsScale(scale);
    mutate({ lyrics_scale: scale });
  };

  const updatePitchGraphScale = (scale: number) => {
    setPitchGraphScale(scale);
    mutate({ pitch_graph_scale: scale });
  };

  const updateVocalThreshold = (pct: number) => {
    setVocalThresholdPct(pct);
    mutate({ vocal_detection_threshold_pct: pct });
  };

  const toggleWindowMode = (fullscreen: boolean) => {
    setIsFullScreen(fullscreen);
    void setFullScreen(fullscreen);
    mutate({ fullscreen });
  };

  const resetDefaults = () => {
    mutate(DEFAULTS);
    setMicMonitorGain(DEFAULTS.mic_monitor_gain);
    setMicLatencySec(DEFAULTS.mic_latency_compensation_sec);
    setLyricsVertical(DEFAULTS.lyrics_vertical_position);
    setLyricsHorizontal(DEFAULTS.lyrics_horizontal_position);
    setLyricsScale(DEFAULTS.lyrics_scale);
    setPitchGraphScale(DEFAULTS.pitch_graph_scale);
    setVocalThresholdPct(DEFAULTS.vocal_detection_threshold_pct);
  };

  const { footerSegment, getFocusClassName, syncFocusFromElement } = useSettingsNavigation({
    containerRef,
    tab,
    isParakeet,
    micMonitorGain,
    micLatencySec,
    lyricsScale,
    pitchGraphScale,
    vocalThresholdPct,
    onBack: close,
    onTabChange: setTab,
    onMicMonitorGainChange: updateMicMonitorGain,
    onMicLatencyChange: updateMicLatency,
    onLyricsScaleChange: updateLyricsScale,
    onPitchGraphScaleChange: updatePitchGraphScale,
    onVocalThresholdChange: updateVocalThreshold,
  });

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto px-4 pb-5 pt-14 sm:px-6 md:pt-5 lg:px-8"
      onMouseMoveCapture={(event) => syncFocusFromElement(event.target)}
      onFocusCapture={(event) => syncFocusFromElement(event.target)}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <PageHeader />

        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isSettingsTab(value)) {
              setTab(value);
            }
          }}
        >
          <TabsList className="scrollbar-hide max-w-full overflow-x-auto overflow-y-hidden sm:w-fit">
            {SETTINGS_TABS.map((settingsTab, slot) => (
              <TabsTrigger
                key={settingsTab.value}
                value={settingsTab.value}
                className={getFocusClassName(NAV.tabSegment, slot)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setTab(settingsTab.value);
                  }
                }}
              >
                {settingsTab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="general" className="mt-4">
            <FieldGroup>
              <Field>
                <Label>Window</Label>
                <ButtonGroup>
                  <Button
                    variant={isFullScreen === true ? 'outline' : 'default'}
                    onClick={() => toggleWindowMode(false)}
                    className={getFocusClassName(NAV.general.window, 0)}
                  >
                    Windowed
                  </Button>
                  <Button
                    variant={isFullScreen === false ? 'outline' : 'default'}
                    onClick={() => toggleWindowMode(true)}
                    className={getFocusClassName(NAV.general.window, 1)}
                  >
                    Fullscreen
                  </Button>
                </ButtonGroup>
              </Field>

              <MicrophoneSettings
                savedMicId={general.preferredMic}
                monitorGain={micMonitorGain}
                latencySec={micLatencySec}
                getFocusClassName={getFocusClassName}
                onMonitorGainChange={updateMicMonitorGain}
                onLatencyChange={updateMicLatency}
              />
            </FieldGroup>
          </TabsContent>

          <TabsContent value="playback" className="mt-4">
            <div className="space-y-5">
              <div className="w-[65%]">
                <PlaybackPreview
                  lyricsVerticalPosition={lyricsVertical}
                  lyricsHorizontalPosition={lyricsHorizontal}
                  lyricsScale={lyricsScale}
                  pitchGraphScale={pitchGraphScale}
                />
              </div>

              <FieldGroup>
                <Field>
                  <Label htmlFor="playback-mode-1">Playback mode</Label>
                  <Hint>Choose whether playback replaces the menu or runs beside it</Hint>
                  <SettingsSelect
                    id="playback-mode-1"
                    label="Playback mode"
                    placeholder="Select playback mode"
                    value={playback.mode}
                    options={PLAYBACK_MODES}
                    triggerClassName={getFocusClassName(NAV.playback.mode)}
                    onValueChange={(playback_mode) => mutate({ playback_mode })}
                  />
                </Field>

                <Field>
                  <Label htmlFor="recordings-folder-1">Recordings folder</Label>
                  <Hint>Finished performances are saved here as 48 kHz MP3 files</Hint>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input
                      id="recordings-folder-1"
                      value={playback.recordingsPath ?? ''}
                      placeholder="No folder selected"
                      disabled
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className={getFocusClassName(NAV.playback.recordingsFolder)}
                      onClick={() => void chooseRecordingsFolder(mutate)}
                    >
                      {recordingsFolderButtonLabel(playback.recordingsPath)}
                    </Button>
                  </div>
                </Field>

                <Field>
                  <Label htmlFor="lyrics-vertical-position-1">Lyrics vertical position</Label>
                  <Hint>Top moves playback HUD and pitch graph to the bottom</Hint>
                  <SettingsSelect
                    id="lyrics-vertical-position-1"
                    label="Lyrics vertical position"
                    placeholder="Select vertical position"
                    value={lyricsVertical}
                    options={LYRICS_VERTICAL_POSITIONS}
                    triggerClassName={getFocusClassName(NAV.playback.lyricsVerticalPosition)}
                    onValueChange={(lyrics_vertical_position) => {
                      setLyricsVertical(lyrics_vertical_position);
                      mutate({ lyrics_vertical_position });
                    }}
                  />
                </Field>

                <Field>
                  <Label htmlFor="lyrics-horizontal-position-1">Lyrics horizontal position</Label>
                  <Hint>Align lyrics left, center, or right during playback</Hint>
                  <SettingsSelect
                    id="lyrics-horizontal-position-1"
                    label="Lyrics horizontal position"
                    placeholder="Select horizontal position"
                    value={lyricsHorizontal}
                    options={LYRICS_HORIZONTAL_POSITIONS}
                    triggerClassName={getFocusClassName(NAV.playback.lyricsHorizontalPosition)}
                    onValueChange={(lyrics_horizontal_position) => {
                      setLyricsHorizontal(lyrics_horizontal_position);
                      mutate({ lyrics_horizontal_position });
                    }}
                  />
                </Field>

                <Field>
                  <Label>Lyrics scale</Label>
                  <Hint>Size of lyrics during playback ({lyricsScalePct}%)</Hint>
                  <Slider
                    min={PLAYBACK_SCALE_MIN * 100}
                    max={PLAYBACK_SCALE_MAX * 100}
                    step={PLAYBACK_SCALE_STEP * 100}
                    value={[lyricsScalePct]}
                    onValueChange={([pct]) => updateLyricsScale(pct / 100)}
                    className={getFocusClassName(NAV.playback.lyricsScale)}
                  />
                </Field>

                <Field>
                  <Label>Pitch graph scale</Label>
                  <Hint>Size of pitch graph during playback ({pitchGraphScalePct}%)</Hint>
                  <Slider
                    min={PLAYBACK_SCALE_MIN * 100}
                    max={PLAYBACK_SCALE_MAX * 100}
                    step={PLAYBACK_SCALE_STEP * 100}
                    value={[pitchGraphScalePct]}
                    onValueChange={([pct]) => updatePitchGraphScale(pct / 100)}
                    className={getFocusClassName(NAV.playback.pitchGraphScale)}
                  />
                </Field>
              </FieldGroup>
            </div>
          </TabsContent>

          <TabsContent value="analysis" className="mt-4">
            <FieldGroup>
              <Field>
                <Label htmlFor="separator-1">Vocal separator</Label>
                <Hint>How vocals are split from the music.</Hint>
                <SettingsSelect
                  id="separator-1"
                  label="Separator"
                  placeholder="Select a separator"
                  value={analysis.separator}
                  options={SEPARATORS}
                  triggerClassName={getFocusClassName(analysisNav.separator)}
                  onValueChange={(separator) => mutate({ separator })}
                />
              </Field>

              <Field>
                <Label htmlFor="asr-engine-1">Transcription model</Label>
                <Hint>Turns the vocals into lyrics.</Hint>
                <SettingsSelect
                  id="asr-engine-1"
                  label="ASR Engine"
                  placeholder="Select an engine"
                  value={asrEngine}
                  options={ASR_ENGINES}
                  triggerClassName={getFocusClassName(analysisNav.asrEngine)}
                  onValueChange={(asr_engine) => mutate({ asr_engine })}
                />
              </Field>

              {!isParakeet && (
                <>
                  <Field>
                    <Label htmlFor="model-1">Model size</Label>
                    <Hint>Smaller models are faster but produce worse results</Hint>
                    <SettingsSelect
                      id="model-1"
                      label="Model size"
                      placeholder="Select a model size"
                      value={analysis.whisperModel}
                      options={modelOptions}
                      triggerClassName={getFocusClassName(analysisNav.whisperModel)}
                      onValueChange={(whisper_model) => mutate({ whisper_model })}
                    />
                  </Field>

                  <Field>
                    <Label>Beam Size</Label>
                    <Hint>Higher values improve accuracy at the cost of speed</Hint>
                    <NumberButtonGroup
                      name="beam_size"
                      value={beamSize}
                      segment={analysisNav.beamSize}
                      getFocusClassName={getFocusClassName}
                      onChange={(beam_size) => mutate({ beam_size })}
                    />
                  </Field>
                </>
              )}

              <Field>
                <Label htmlFor="align-backend-1">Alignment model</Label>
                <Hint>How each word is timed to the audio.</Hint>
                <SettingsSelect
                  id="align-backend-1"
                  label="Forced alignment"
                  placeholder="Select an alignment backend"
                  value={analysis.alignBackend}
                  options={ALIGN_BACKENDS}
                  triggerClassName={getFocusClassName(analysisNav.alignBackend)}
                  onValueChange={(align_backend) => mutate({ align_backend })}
                />
              </Field>

              <Field>
                <Label>Auto-analyze</Label>
                <Hint>Automatically queue every unanalyzed song after scans finish</Hint>
                <ButtonGroup>
                  <Button
                    variant={analysis.autoAnalyze ? 'outline' : 'default'}
                    onClick={() => mutate({ auto_analyze: false })}
                    className={getFocusClassName(analysisNav.autoAnalyze, 0)}
                  >
                    Off
                  </Button>
                  <Button
                    variant={analysis.autoAnalyze ? 'default' : 'outline'}
                    onClick={() => mutate({ auto_analyze: true })}
                    className={getFocusClassName(analysisNav.autoAnalyze, 1)}
                  >
                    On
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Vocal detection sensitivity</Label>
                <Hint>
                  How loud the vocals must be to count as the song's start and end. Lower it if
                  quiet intros, outros, or soft singing get cut off; raise it to trim more silence (
                  {vocalThresholdDisplayPct}% of the loudest moment)
                </Hint>
                <Slider
                  min={0}
                  max={Math.round(VOCAL_THRESHOLD_MAX * 100)}
                  step={1}
                  value={[vocalThresholdDisplayPct]}
                  onValueChange={([pct]) => updateVocalThreshold(pct / 100)}
                  className={getFocusClassName(analysisNav.vocalThreshold)}
                />
              </Field>

              <Field>
                <Label>Batch Size</Label>
                <Hint>Higher values use more memory but process faster</Hint>
                <NumberButtonGroup
                  name="batch_size"
                  value={batchSize}
                  segment={analysisNav.batchSize}
                  getFocusClassName={getFocusClassName}
                  onChange={(batch_size) => mutate({ batch_size })}
                />
              </Field>
            </FieldGroup>
          </TabsContent>
        </Tabs>

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={resetDefaults}
            className={getFocusClassName(footerSegment, 0)}
          >
            Restore Defaults
          </Button>
          <Button variant="outline" onClick={close} className={getFocusClassName(footerSegment, 1)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
