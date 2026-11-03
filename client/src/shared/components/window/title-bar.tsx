import { getCurrentWindow } from '@tauri-apps/api/window';
import { MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { loadConfig, saveConfig } from '@/bridge/config';
import {
  FULLSCREEN_CHANGE_EVENT,
  isFullScreen as tauriIsFullScreen,
  setFullScreen,
} from '@/bridge/fullScreen';
import { isSessionPlayback } from '@/bridge/playback-session';
import { isTauri } from '@/bridge/runtime';
import { minimizeWindow, triggerFrontendReady, windowImmersive } from '@/bridge/window';
import { t } from '@/i18n';

export function TauriAppShell({ children }: { children: React.ReactNode }) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!isTauri) {
      return undefined;
    }

    const refreshFullscreen = () => {
      void windowImmersive()
        .then(setFullscreen)
        .catch(() => undefined);
    };

    void triggerFrontendReady().catch(() => undefined);
    refreshFullscreen();
    window.addEventListener(FULLSCREEN_CHANGE_EVENT, refreshFullscreen);

    return () => window.removeEventListener(FULLSCREEN_CHANGE_EVENT, refreshFullscreen);
  }, []);

  useEffect(() => {
    if (!isTauri) {
      return undefined;
    }

    const toggleFullscreen = async (): Promise<void> => {
      const [current, config] = await Promise.all([tauriIsFullScreen(), loadConfig()]);
      const next = !current;
      await Promise.all([setFullScreen(next), saveConfig({ ...config, fullscreen: next })]);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'F11') {
        return;
      }
      event.preventDefault();
      void toggleFullscreen().catch(() => undefined);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!isTauri) {
    return children;
  }

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <TitleBar fullscreen={fullscreen} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

function TitleBar({ fullscreen }: { fullscreen: boolean }) {
  const sessionPlayback = isSessionPlayback();

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--titlebar-offset',
      fullscreen || sessionPlayback ? '0px' : '2rem',
    );

    return () => {
      document.documentElement.style.removeProperty('--titlebar-offset');
    };
  }, [fullscreen, sessionPlayback]);

  if (fullscreen) {
    return null;
  }

  const win = getCurrentWindow();

  if (sessionPlayback) {
    return (
      <div className="fixed right-2 top-2 z-50 flex h-8 items-center overflow-hidden rounded-md border border-border bg-background/85 shadow-md backdrop-blur-sm">
        <div
          className="h-full w-12 cursor-move border-r border-border"
          aria-hidden
          title={t('shared.window.titleBar.dragPlaybackWindow')}
          onMouseDown={() => void win.startDragging()}
        />
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={t('shared.window.titleBar.minimize')}
          onClick={() => void minimizeWindow()}
        >
          <MinusIcon className="size-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={t('shared.window.titleBar.maximize')}
          onClick={() => void win.toggleMaximize()}
        >
          <SquareIcon className="size-3" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
          aria-label={t('common.actions.close')}
          onClick={() => void win.close()}
        >
          <XIcon className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <header className="flex h-8 shrink-0 select-none items-stretch border-b border-border bg-background">
      <div
        className="min-h-0 min-w-0 flex-1"
        aria-hidden
        onMouseDown={() => void win.startDragging()}
      />
      <div className="flex items-center gap-0.5 pl-1 pr-1.5">
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={t('shared.window.titleBar.minimize')}
          onClick={() => void minimizeWindow()}
        >
          <MinusIcon className="size-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={t('shared.window.titleBar.maximize')}
          onClick={() => void win.toggleMaximize()}
        >
          <SquareIcon className="size-3" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
          aria-label={t('common.actions.close')}
          onClick={() => void win.close()}
        >
          <XIcon className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}
