import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { setFullScreen, isFullScreen as tauriIsFullScreen } from '@/bridge/fullScreen';
import { openUrl } from '@/bridge/opener';
import { clampPlaybackScale, DEFAULT_PLAYBACK_SCALE } from '@/features/playback/lib/display-scale';
import { BackgroundSettings } from '@/features/settings/components/background-settings';
import {
  ALIGN_BACKENDS,
  ASR_ENGINES,
  DEFAULTS,
  LYRICS_HORIZONTAL_POSITIONS,
  LYRICS_ROMANIZATION_MODES,
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
  SettingsButtonGroup,
  SettingsSelect,
} from '@/features/settings/components/settings-controls';
import { useSettingsNavigation } from '@/features/settings/hooks/use-settings-navigation';
import { LANGUAGE_OPTIONS, t, useTranslation } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { ButtonGroup } from '@/shared/components/ui/button-group';
import { Field, FieldGroup } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { Slider } from '@/shared/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import { cn } from '@/shared/utils/cn';
import type { AppConfig } from '@/types/AppConfig';

const TRANSLATIONS_URL =
  'https://github.com/rzru/nightingale/tree/master/client/src/i18n/translations#readme';

const generalSettings = (config: AppConfig | undefined) => {
  if (!config) {
    return {
      fullscreen: undefined,
      preferredMic: null,
      combineMultiChannel: true,
      micMonitorGain: DEFAULTS.mic_monitor_gain,
      micLatency: DEFAULTS.mic_latency_compensation_sec,
    };
  }

  return {
    fullscreen: config.fullscreen,
    preferredMic: config.preferred_mic,
    combineMultiChannel: config.combine_multi_channel ?? true,
    micMonitorGain: config.mic_monitor_gain ?? DEFAULTS.mic_monitor_gain,
    micLatency: config.mic_latency_compensation_sec ?? DEFAULTS.mic_latency_compensation_sec,
  };
};

const playbackSettings = (config: AppConfig | undefined) => {
  if (!config) {
    return {
      mode: DEFAULTS.playback_mode,
      masterVolume: DEFAULTS.master_volume,
      lyricsVertical: DEFAULTS.lyrics_vertical_position,
      lyricsHorizontal: DEFAULTS.lyrics_horizontal_position,
      lyricsScale: DEFAULT_PLAYBACK_SCALE,
      pitchGraphScale: DEFAULT_PLAYBACK_SCALE,
      lyricsRomanizationMode: DEFAULTS.lyrics_romanization_mode,
    };
  }

  return {
    mode: config.playback_mode ?? DEFAULTS.playback_mode,
    masterVolume: config.master_volume ?? DEFAULTS.master_volume,
    lyricsVertical: config.lyrics_vertical_position ?? DEFAULTS.lyrics_vertical_position,
    lyricsHorizontal: config.lyrics_horizontal_position ?? DEFAULTS.lyrics_horizontal_position,
    lyricsScale: clampPlaybackScale(config.lyrics_scale),
    pitchGraphScale: clampPlaybackScale(config.pitch_graph_scale),
    lyricsRomanizationMode: config.lyrics_romanization_mode ?? DEFAULTS.lyrics_romanization_mode,
  };
};

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

export const SettingsPage = () => {
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();
  const { preference, setLanguage } = useTranslation();

  const containerRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SettingsTab>('general');
  const [backgroundDialogOpen, setBackgroundDialogOpen] = useState(false);
  const [hasMultiChannelInput, setHasMultiChannelInput] = useState(false);
  const general = generalSettings(config);
  const playback = playbackSettings(config);
  const analysis = analysisSettings(config);
  const [isFullScreen, setIsFullScreen] = useState<boolean | null | undefined>(general.fullscreen);
  const [micMonitorGainInput, setMicMonitorGain] = useState<number | null>(null);
  const micMonitorGain = micMonitorGainInput ?? general.micMonitorGain;
  const [micLatencySecInput, setMicLatencySec] = useState<number | null>(null);
  const micLatencySec = micLatencySecInput ?? general.micLatency;
  const [masterVolumeInput, setMasterVolume] = useState<number | null>(null);
  const masterVolume = masterVolumeInput ?? playback.masterVolume;
  const [lyricsVerticalInput, setLyricsVertical] = useState<string | null>(null);
  const lyricsVertical = pendingValue(lyricsVerticalInput, playback.lyricsVertical);
  const [lyricsHorizontalInput, setLyricsHorizontal] = useState<string | null>(null);
  const lyricsHorizontal = pendingValue(lyricsHorizontalInput, playback.lyricsHorizontal);
  const [lyricsScaleInput, setLyricsScale] = useState<number | null>(null);
  const lyricsScale = pendingValue(lyricsScaleInput, playback.lyricsScale);
  const [pitchGraphScaleInput, setPitchGraphScale] = useState<number | null>(null);
  const pitchGraphScale = pendingValue(pitchGraphScaleInput, playback.pitchGraphScale);
  const [lyricsRomanizationModeInput, setLyricsRomanizationMode] = useState<string | null>(null);
  const lyricsRomanizationMode = pendingValue(
    lyricsRomanizationModeInput,
    playback.lyricsRomanizationMode,
  );
  const [vocalThresholdPctInput, setVocalThresholdPct] = useState<number | null>(null);
  const vocalThresholdPct = vocalThresholdPctInput ?? analysis.vocalThreshold;

  const close = (): void => {
    void navigate('/');
  };
  const asrEngine = analysis.asrEngine;
  const isParakeet = asrEngine === 'parakeet';
  const analysisNav = getAnalysisNav(isParakeet);

  const modelOptions = useMemo(() => MODELS.map((model) => ({ value: model, label: model })), []);
  const masterVolumePct = Math.round(masterVolume * 100);
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

  const updateMasterVolume = (volume: number) => {
    setMasterVolume(volume);
    mutate({ master_volume: volume });
  };

  const updateLanguage = (language: string) => {
    setLanguage(language);
    mutate({ language: language === 'system' ? null : language });
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
    setMasterVolume(DEFAULTS.master_volume);
    setLyricsVertical(DEFAULTS.lyrics_vertical_position);
    setLyricsHorizontal(DEFAULTS.lyrics_horizontal_position);
    setLyricsScale(DEFAULTS.lyrics_scale);
    setPitchGraphScale(DEFAULTS.pitch_graph_scale);
    setLyricsRomanizationMode(DEFAULTS.lyrics_romanization_mode);
    setVocalThresholdPct(DEFAULTS.vocal_detection_threshold_pct);
  };

  const { footerSegment, getFocusClassName, syncFocusFromElement } = useSettingsNavigation({
    containerRef,
    enabled: !backgroundDialogOpen,
    tab,
    isParakeet,
    hasMultiChannelInput,
    micMonitorGain,
    micLatencySec,
    masterVolume,
    lyricsScale,
    pitchGraphScale,
    vocalThresholdPct,
    onBack: close,
    onTabChange: setTab,
    onMicMonitorGainChange: updateMicMonitorGain,
    onMicLatencyChange: updateMicLatency,
    onMasterVolumeChange: updateMasterVolume,
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
                {t(settingsTab.label)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="general" className="mt-4">
            <FieldGroup>
              <Field>
                <Label>{t('settings.window')}</Label>
                <ButtonGroup>
                  <Button
                    variant={isFullScreen === true ? 'outline' : 'default'}
                    onClick={() => toggleWindowMode(false)}
                    className={getFocusClassName(NAV.general.window, 0)}
                  >
                    {t('settings.windowed')}
                  </Button>
                  <Button
                    variant={isFullScreen === false ? 'outline' : 'default'}
                    onClick={() => toggleWindowMode(true)}
                    className={getFocusClassName(NAV.general.window, 1)}
                  >
                    {t('settings.fullscreen')}
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="interface-language">
                    {t('settings.language.interfaceLabel')}
                  </Label>
                  <Button
                    variant="link"
                    className={cn(
                      'h-auto px-0 leading-none',
                      getFocusClassName(NAV.general.language, 1),
                    )}
                    onClick={() => void openUrl(TRANSLATIONS_URL)}
                  >
                    {t('settings.language.contribute')}
                  </Button>
                </div>
                <Hint>{t('settings.language.description')}</Hint>
                <SettingsSelect
                  id="interface-language"
                  label={t('settings.language.label')}
                  placeholder={t('settings.language.placeholder')}
                  value={preference}
                  options={LANGUAGE_OPTIONS}
                  triggerClassName={getFocusClassName(NAV.general.language, 0)}
                  onValueChange={updateLanguage}
                />
              </Field>

              <MicrophoneSettings
                savedMicId={general.preferredMic}
                combineMultiChannel={general.combineMultiChannel}
                monitorGain={micMonitorGain}
                latencySec={micLatencySec}
                getFocusClassName={getFocusClassName}
                onMultiChannelAvailabilityChange={setHasMultiChannelInput}
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
                <BackgroundSettings
                  selectClassName={getFocusClassName(NAV.playback.background, 0)}
                  manageClassName={getFocusClassName(NAV.playback.background, 1)}
                  onDialogOpenChange={setBackgroundDialogOpen}
                />

                <Field>
                  <Label htmlFor="playback-mode-1">{t('settings.playbackMode')}</Label>
                  <Hint>{t('settings.chooseWhetherPlaybackReplacesTheDescription')}</Hint>
                  <SettingsSelect
                    id="settings.playbackMode1"
                    label={t('settings.playbackMode')}
                    placeholder={t('settings.selectPlaybackMode')}
                    value={playback.mode}
                    options={PLAYBACK_MODES}
                    triggerClassName={getFocusClassName(NAV.playback.mode)}
                    onValueChange={(playback_mode) => mutate({ playback_mode })}
                  />
                </Field>

                <Field>
                  <Label>{t('settings.masterVolume')}</Label>
                  <Hint>
                    {t('settings.overallPlaybackVolumeValue1', { value1: masterVolumePct })}
                  </Hint>
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[masterVolumePct]}
                    onValueChange={([pct]) => updateMasterVolume(pct / 100)}
                    className={getFocusClassName(NAV.playback.masterVolume)}
                  />
                </Field>

                <Field>
                  <Label htmlFor="lyrics-vertical-position-1">
                    {t('settings.lyricsVerticalPosition')}
                  </Label>
                  <Hint>{t('settings.topMovesPlaybackHudAndDescription')}</Hint>
                  <SettingsSelect
                    id="settings.lyricsVerticalPosition1"
                    label={t('settings.lyricsVerticalPosition')}
                    placeholder={t('settings.selectVerticalPosition')}
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
                  <Label htmlFor="lyrics-horizontal-position-1">
                    {t('settings.lyricsHorizontalPosition')}
                  </Label>
                  <Hint>{t('settings.alignLyricsLeftCenterOrDescription')}</Hint>
                  <SettingsSelect
                    id="settings.lyricsHorizontalPosition1"
                    label={t('settings.lyricsHorizontalPosition')}
                    placeholder={t('settings.selectHorizontalPosition')}
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
                  <Label>{t('settings.lyricsScale')}</Label>
                  <Hint>
                    {t('settings.sizeOfLyricsDuringPlaybackValue1', { value1: lyricsScalePct })}
                  </Hint>
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
                  <Label>{t('settings.pitchGraphScale')}</Label>
                  <Hint>
                    {t('settings.sizeOfPitchGraphDuringPlaybackValue1', {
                      value1: pitchGraphScalePct,
                    })}
                  </Hint>
                  <Slider
                    min={PLAYBACK_SCALE_MIN * 100}
                    max={PLAYBACK_SCALE_MAX * 100}
                    step={PLAYBACK_SCALE_STEP * 100}
                    value={[pitchGraphScalePct]}
                    onValueChange={([pct]) => updatePitchGraphScale(pct / 100)}
                    className={getFocusClassName(NAV.playback.pitchGraphScale)}
                  />
                </Field>

                <Field>
                  <Label>{t('settings.romanizeLyrics')}</Label>
                  <Hint>{t('settings.whetherToShowRomanizedLyricsDescription')}</Hint>
                  <SettingsButtonGroup
                    value={lyricsRomanizationMode}
                    options={LYRICS_ROMANIZATION_MODES}
                    segment={NAV.playback.lyricsRomanizationMode}
                    getFocusClassName={getFocusClassName}
                    onChange={(lyrics_romanization_mode) => {
                      setLyricsRomanizationMode(lyrics_romanization_mode);
                      mutate({ lyrics_romanization_mode });
                    }}
                  />
                </Field>
              </FieldGroup>
            </div>
          </TabsContent>

          <TabsContent value="analysis" className="mt-4">
            <FieldGroup>
              <Field>
                <Label htmlFor="separator-1">{t('settings.vocalSeparator')}</Label>
                <Hint>{t('settings.howVocalsAreSplitFromTheMusic')}</Hint>
                <SettingsSelect
                  id="settings.separator1"
                  label={t('settings.separator')}
                  placeholder={t('settings.selectASeparator')}
                  value={analysis.separator}
                  options={SEPARATORS}
                  triggerClassName={getFocusClassName(analysisNav.separator)}
                  onValueChange={(separator) => mutate({ separator })}
                />
              </Field>

              <Field>
                <Label htmlFor="asr-engine-1">{t('settings.transcriptionModel')}</Label>
                <Hint>{t('settings.turnsTheVocalsIntoLyrics')}</Hint>
                <SettingsSelect
                  id="settings.asrEngine1"
                  label={t('settings.asrEngine')}
                  placeholder={t('settings.selectAnEngine')}
                  value={asrEngine}
                  options={ASR_ENGINES}
                  triggerClassName={getFocusClassName(analysisNav.asrEngine)}
                  onValueChange={(asr_engine) => mutate({ asr_engine })}
                />
              </Field>

              {!isParakeet && (
                <>
                  <Field>
                    <Label htmlFor="model-1">{t('settings.modelSize')}</Label>
                    <Hint>{t('settings.smallerModelsAreFasterButDescription')}</Hint>
                    <SettingsSelect
                      id="settings.model1"
                      label={t('settings.modelSize')}
                      placeholder={t('settings.selectAModelSize')}
                      value={analysis.whisperModel}
                      options={modelOptions}
                      triggerClassName={getFocusClassName(analysisNav.whisperModel)}
                      onValueChange={(whisper_model) => mutate({ whisper_model })}
                    />
                  </Field>

                  <Field>
                    <Label>{t('settings.beamSize')}</Label>
                    <Hint>{t('settings.higherValuesImproveAccuracyAtDescription')}</Hint>
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
                <Label htmlFor="align-backend-1">{t('settings.alignmentModel')}</Label>
                <Hint>{t('settings.howEachWordIsTimedDescription')}</Hint>
                <SettingsSelect
                  id="settings.alignBackend1"
                  label={t('settings.forcedAlignment')}
                  placeholder={t('settings.selectAnAlignmentBackend')}
                  value={analysis.alignBackend}
                  options={ALIGN_BACKENDS}
                  triggerClassName={getFocusClassName(analysisNav.alignBackend)}
                  onValueChange={(align_backend) => mutate({ align_backend })}
                />
              </Field>

              <Field>
                <Label>{t('settings.autoAnalyze')}</Label>
                <Hint>{t('settings.automaticallyQueueEveryUnanalyzedSongDescription')}</Hint>
                <ButtonGroup>
                  <Button
                    variant={analysis.autoAnalyze ? 'outline' : 'default'}
                    onClick={() => mutate({ auto_analyze: false })}
                    className={getFocusClassName(analysisNav.autoAnalyze, 0)}
                  >
                    {t('common.states.off')}
                  </Button>
                  <Button
                    variant={analysis.autoAnalyze ? 'default' : 'outline'}
                    onClick={() => mutate({ auto_analyze: true })}
                    className={getFocusClassName(analysisNav.autoAnalyze, 1)}
                  >
                    {t('common.states.on')}
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>{t('settings.vocalDetectionSensitivity')}</Label>
                <Hint>
                  {t('settings.howLoudTheVocalsMustDescription', {
                    value1: vocalThresholdDisplayPct,
                  })}
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
                <Label>{t('settings.batchSize')}</Label>
                <Hint>{t('settings.higherValuesUseMoreMemoryDescription')}</Hint>
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
            {t('settings.restoreDefaults')}
          </Button>
          <Button variant="outline" onClick={close} className={getFocusClassName(footerSegment, 1)}>
            {t('common.actions.close')}
          </Button>
        </div>
      </div>
    </div>
  );
};
