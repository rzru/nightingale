import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import logoSrc from '@/assets/images/logo_square.png';
import { exit, EXIT_SUPPORTED } from '@/bridge/exit';
import { getServerFlags } from '@/bridge/server-flags';
import { onSetupError, onSetupProgress, triggerSetup } from '@/bridge/setup';
import { selectFolderPath } from '@/bridge/source';
import { useNavInput } from '@/features/menu/hooks/use-nav-input';
import { useShouldRunSetup } from '@/features/setup/hooks/use-should-run-setup';
import { t, type TranslationKey } from '@/i18n';
import { Trans } from '@/i18n/trans';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Progress } from '@/shared/components/ui/progress';
import { useConfig } from '@/shared/config/use-config';
import { ANALYSIS_QUEUE, CONFIG, MENU, SONGS, SONGS_META } from '@/shared/query-keys';
import type { CachePaths } from '@/types/CachePaths';
import type { SetupProgress } from '@/types/SetupProgress';
import type { SetupStep } from '@/types/SetupStep';

type SetupViewStep = SetupStep | 'init' | 'error' | 'changedatafolder';
type LoadingStep = Exclude<SetupViewStep, 'init' | 'error' | 'changedatafolder' | 'finish'>;

type ExtendedSetupProgress = {
  step: SetupViewStep;
} & Omit<SetupProgress, 'step'>;

const LOADING_STEPS: ReadonlySet<SetupViewStep> = new Set([
  'clearvendor',
  'ffmpeg',
  'migratedata',
  'uv',
  'python',
  'venv',
  'dependencies',
  'extractscripts',
  'videos',
]);

const isLoadingStep = (step: SetupViewStep): step is LoadingStep => LOADING_STEPS.has(step);

type InitialStepProps = {
  toNextStep: () => void;
};

const InitialStep = ({ toNextStep }: InitialStepProps) => {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('setup.welcomeToNightingale')}</AlertDialogTitle>
        <AlertDialogDescription>
          <Trans
            id="setup.beforeYouGetStartedWeDescription"
            values={{
              ffmpeg: <code>ffmpeg</code>,
              uv: <code>uv</code>,
              python: <code>python 3.10</code>,
              cuda: <code>CUDA</code>,
            }}
          />
        </AlertDialogDescription>
        <AlertDialogDescription>
          {t('setup.thisMayTakeAFewMinutes')}
          {EXIT_SUPPORTED && ` ${t('setup.youCanExitAtAnyDescription')}`}
        </AlertDialogDescription>
        <AlertDialogDescription>{t('setup.thisOnlyHappensOnce')}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        {EXIT_SUPPORTED && (
          <AlertDialogCancel onClick={() => void exit()}>{t('setup.exit')}</AlertDialogCancel>
        )}
        <AlertDialogAction onClick={toNextStep}>{t('common.actions.continue')}</AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
};

type CachePathKey = keyof CachePaths;

type ChangeDataStepProps = {
  onStart: () => Promise<void>;
  folder?: string;
  setFolder: (folder?: string) => void;
  separateCacheFolders: boolean;
  setSeparateCacheFolders: (enabled: boolean) => void;
  cacheFolders: CachePaths;
  setCacheFolder: (key: CachePathKey, folder?: string) => void;
};

const cacheFolderLabels: Array<[CachePathKey, TranslationKey, TranslationKey]> = [
  ['songs', 'setup.cacheFolders.songs', 'setup.cacheFolders.songsDescription'],
  ['videos', 'setup.cacheFolders.videos', 'setup.cacheFolders.videosDescription'],
  ['models', 'setup.cacheFolders.models', 'setup.cacheFolders.modelsDescription'],
  ['vendor', 'setup.cacheFolders.vendor', 'setup.cacheFolders.vendorDescription'],
];

const FolderPicker = ({
  value,
  onChange,
  buttonLabel,
}: {
  value?: string | null;
  onChange: (folder?: string) => void;
  buttonLabel?: string;
}) => {
  const chooseFolder = async (): Promise<void> => {
    const folder = await selectFolderPath();
    if (typeof folder === 'string' && folder !== '') {
      onChange(folder);
    }
  };

  return (
    <div className="grid w-full justify-self-stretch grid-cols-[minmax(0,1fr)_auto] gap-2">
      <Input value={value ?? ''} disabled className="min-w-0 w-full" />
      <Button
        variant="outline"
        className="w-fit whitespace-nowrap"
        onClick={() => void chooseFolder()}
      >
        {typeof value === 'string' && value !== ''
          ? t('setup.changeFolder')
          : (buttonLabel ?? t('setup.chooseFolder'))}
      </Button>
    </div>
  );
};

const ChangeDataFolderStep = ({
  onStart,
  folder,
  setFolder,
  separateCacheFolders,
  setSeparateCacheFolders,
  cacheFolders,
  setCacheFolder,
}: ChangeDataStepProps) => (
  <>
    <AlertDialogHeader className="w-full place-items-stretch text-left">
      <AlertDialogTitle>{t('setup.dataFolder')}</AlertDialogTitle>
      <>
        <AlertDialogDescription className="mb-2">
          <Trans
            id="setup.chooseWhereNightingaleStoresAppDescription"
            values={{
              config: <code>config.json</code>,
              log: <code>nightingale.log</code>,
              path: <code>~/.nightingale</code>,
            }}
          />
        </AlertDialogDescription>
        {!separateCacheFolders && <FolderPicker value={folder} onChange={setFolder} />}
        <Label className="mt-1 gap-1.5 text-xs/relaxed font-normal text-muted-foreground">
          <Checkbox
            checked={separateCacheFolders}
            onCheckedChange={(checked) => setSeparateCacheFolders(checked === true)}
          />
          {t('setup.useDifferentFoldersPerCacheType')}
        </Label>
        {separateCacheFolders && (
          <div className="mt-2 flex w-full flex-col gap-3">
            {cacheFolderLabels.map(([key, label, description]) => (
              <div key={key} className="flex w-full flex-col gap-1">
                <div className="text-sm font-medium">{t(label)}</div>
                <div className="text-xs text-muted-foreground">{t(description)}</div>
                <FolderPicker
                  value={cacheFolders[key]}
                  onChange={(cachePath) => setCacheFolder(key, cachePath)}
                  buttonLabel={t('setup.chooseFolder')}
                />
              </div>
            ))}
          </div>
        )}
      </>
    </AlertDialogHeader>
    <AlertDialogFooter>
      {EXIT_SUPPORTED && (
        <AlertDialogCancel onClick={() => void exit()}>{t('setup.exit')}</AlertDialogCancel>
      )}
      <AlertDialogAction onClick={() => void onStart()}>
        {t('common.actions.continue')}
      </AlertDialogAction>
    </AlertDialogFooter>
  </>
);

type LoadStepProps = {
  action: string;
  percent: number;
};

const LoadStep = ({ action, percent }: LoadStepProps) => (
  <>
    <AlertDialogHeader>
      <AlertDialogTitle>{t('setup.settingUpNightingale')}</AlertDialogTitle>
      <div className="flex flex-col gap-2 w-full">
        <AlertDialogDescription className="w-full">{action}</AlertDialogDescription>
        <Progress value={percent} />
      </div>
    </AlertDialogHeader>
    {EXIT_SUPPORTED && (
      <AlertDialogFooter>
        <AlertDialogCancel onClick={() => void exit()}>{t('setup.exit')}</AlertDialogCancel>
      </AlertDialogFooter>
    )}
  </>
);

type ErrorStepProps = {
  error: string;
};

const ErrorStep = ({ error }: ErrorStepProps) => (
  <>
    <AlertDialogHeader className="min-w-0 w-full">
      <AlertDialogTitle>{t('setup.somethingWentWrong')}</AlertDialogTitle>
      <AlertDialogDescription className="max-h-[50svh] min-w-0 w-full overflow-y-auto text-left">
        <code className="block whitespace-pre-wrap [overflow-wrap:anywhere]">{error}</code>
      </AlertDialogDescription>
    </AlertDialogHeader>
    {EXIT_SUPPORTED && (
      <AlertDialogFooter>
        <AlertDialogAction onClick={() => void exit()}>{t('setup.exit')}</AlertDialogAction>
      </AlertDialogFooter>
    )}
  </>
);

type FinalStepProps = {
  onFinish: () => void;
  folder?: string;
  vendorFolder?: string | null;
};

const defaultCachePaths = (base?: string | null): CachePaths => ({
  songs: typeof base === 'string' && base !== '' ? `${base}/cache` : null,
  videos: typeof base === 'string' && base !== '' ? `${base}/videos` : null,
  models: typeof base === 'string' && base !== '' ? `${base}/models` : null,
  vendor: typeof base === 'string' && base !== '' ? `${base}/vendor` : null,
});

const optionalCachePath = (path?: string | null): string | null => {
  const trimmed = path?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
};

const selectedCachePaths = (enabled: boolean, paths: CachePaths): CachePaths | undefined => {
  if (!enabled) {
    return undefined;
  }

  return {
    songs: optionalCachePath(paths.songs),
    videos: optionalCachePath(paths.videos),
    models: optionalCachePath(paths.models),
    vendor: optionalCachePath(paths.vendor),
  };
};

const FinalStep = ({ onFinish, folder, vendorFolder }: FinalStepProps) => (
  <>
    <AlertDialogHeader>
      <AlertDialogTitle>{t('setup.youReAllSet')}</AlertDialogTitle>
      <AlertDialogDescription>
        <Trans
          id="setup.allDependenciesHaveBeenInstalledDescription"
          values={{ folder: <code>{vendorFolder ?? `${folder}/vendor`}</code> }}
        />
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogAction onClick={onFinish}>{t('setup.getStarted')}</AlertDialogAction>
    </AlertDialogFooter>
  </>
);

const defaultProgress = {
  step: 'init' as const,
  percent: 0,
  action: '',
};

export const Setup = () => {
  const { data: config } = useConfig();
  const { shouldRunSetup, setShouldRunSetup } = useShouldRunSetup();
  const queryClient = useQueryClient();

  // In self-hosted deployments the operator fixes the data folder via
  // NIGHTINGALE_DATA_PATH (e.g. the /data volume in Docker), so there's nothing
  // for the browser user to choose — skip the data-folder step entirely.
  const { dataPathPinned } = getServerFlags();

  const [overrideFolderInput, setOverrideFolderInput] = useState<string | null>(null);
  const overrideFolder = overrideFolderInput ?? config?.data_path;
  const setOverrideFolder = useCallback(
    (folder?: string) => setOverrideFolderInput(folder ?? null),
    [],
  );
  const [separateCacheFoldersInput, setSeparateCacheFoldersInput] = useState<boolean | null>(null);
  const setSeparateCacheFolders = useCallback(
    (enabled: boolean) => setSeparateCacheFoldersInput(enabled),
    [],
  );
  const separateCacheFolders = separateCacheFoldersInput ?? Boolean(config?.cache_paths);
  const [cacheFolderOverrides, setCacheFolderOverrides] = useState<Partial<CachePaths>>({});
  const cacheFolders = useMemo(
    () => ({
      ...(config?.cache_paths ?? defaultCachePaths(overrideFolder)),
      ...cacheFolderOverrides,
    }),
    [cacheFolderOverrides, config?.cache_paths, overrideFolder],
  );
  const [setupProgress, setSetupProgress] = useState<ExtendedSetupProgress>(defaultProgress);

  const setCacheFolder = useCallback((key: CachePathKey, folder?: string) => {
    setCacheFolderOverrides((current) => ({ ...current, [key]: folder ?? null }));
  }, []);

  const startSetup = useCallback(
    () =>
      triggerSetup(
        dataPathPinned ? undefined : (overrideFolder ?? undefined),
        dataPathPinned ? undefined : selectedCachePaths(separateCacheFolders, cacheFolders),
      ),
    [cacheFolders, dataPathPinned, overrideFolder, separateCacheFolders],
  );

  const invalidatePostSetupState = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CONFIG }),
      queryClient.invalidateQueries({ queryKey: SONGS_META }),
      queryClient.invalidateQueries({ queryKey: SONGS }),
      queryClient.invalidateQueries({ queryKey: MENU }),
      queryClient.invalidateQueries({ queryKey: ANALYSIS_QUEUE }),
    ]);
  }, [queryClient]);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    void onSetupProgress((progress) => {
      setSetupProgress(progress);
      if (progress.step === 'finish') {
        void invalidatePostSetupState();
      }
    }).then((fn) => {
      unlistenProgress = fn;
      return undefined;
    });

    void onSetupError((error) => {
      setSetupProgress({ step: 'error', percent: 0, action: error });
    }).then((fn) => {
      unlistenError = fn;
      return undefined;
    });

    return () => {
      unlistenProgress?.();
      unlistenError?.();
    };
  }, [invalidatePostSetupState]);

  const { step, percent, action } = setupProgress;

  useNavInput(
    useCallback(
      (navAction) => {
        if (!shouldRunSetup) {
          return;
        }

        if (navAction.back) {
          if (step === 'finish') {
            setShouldRunSetup(false);
          } else if (EXIT_SUPPORTED) {
            void exit();
          }

          return;
        }

        if (navAction.confirm) {
          if (step === 'init') {
            void startSetup();
          } else if (step === 'finish') {
            void invalidatePostSetupState();
            setShouldRunSetup(false);
          } else if (step === 'error' && EXIT_SUPPORTED) {
            void exit();
          }
        }
      },
      [invalidatePostSetupState, setShouldRunSetup, shouldRunSetup, startSetup, step],
    ),
  );

  const stepContent = useMemo(() => {
    if (isLoadingStep(step)) {
      return <LoadStep action={action} percent={percent} />;
    }

    switch (step) {
      case 'init':
        return (
          <InitialStep
            toNextStep={() => {
              if (dataPathPinned) {
                void startSetup();
                return;
              }
              setSetupProgress({ ...setupProgress, step: 'changedatafolder' });
            }}
          />
        );
      case 'changedatafolder':
        return (
          <ChangeDataFolderStep
            folder={overrideFolder ?? undefined}
            setFolder={setOverrideFolder}
            separateCacheFolders={separateCacheFolders}
            setSeparateCacheFolders={setSeparateCacheFolders}
            cacheFolders={cacheFolders}
            setCacheFolder={setCacheFolder}
            onStart={startSetup}
          />
        );
      case 'finish':
        return (
          <FinalStep
            folder={overrideFolder ?? undefined}
            vendorFolder={separateCacheFolders ? cacheFolders.vendor : undefined}
            onFinish={() => {
              void invalidatePostSetupState();
              setSetupProgress(defaultProgress);
              setShouldRunSetup(false);
            }}
          />
        );
      case 'error':
        return <ErrorStep error={action} />;
    }

    step satisfies never;
    return null;
  }, [
    step,
    action,
    percent,
    overrideFolder,
    separateCacheFolders,
    cacheFolders,
    setCacheFolder,
    setOverrideFolder,
    setSeparateCacheFolders,
    startSetup,
    dataPathPinned,
    invalidatePostSetupState,
    setShouldRunSetup,
    setupProgress,
  ]);

  return (
    <AlertDialog open={shouldRunSetup}>
      <AlertDialogContent
        data-nav-passthrough
        className="max-h-[calc(100svh-2rem)] overflow-y-auto"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <img src={logoSrc} width={80} height={80} alt="Nightingale" />
        {stepContent}
      </AlertDialogContent>
    </AlertDialog>
  );
};
