import './app.css';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';

import { UPDATES_SUPPORTED } from '@/bridge/platform';
import { loadInterfaceLanguage } from '@/bridge/remote-control';
import { LibraryPage } from '@/features/library/library-page';
import { MenuLayout } from '@/features/menu/menu';
import { MenuFocusProvider } from '@/features/menu/providers/menu-focus-context';
import { Playback } from '@/features/playback/playback';
import { RemoteQueuePage } from '@/features/remote/remote-queue';
import { SettingsPage } from '@/features/settings/settings';
import { useUpdate } from '@/features/updates/queries/use-update';
import { syncLanguagePreference, useTranslation } from '@/i18n';
import { Toaster } from '@/shared/components/ui/sonner';
import { TooltipProvider } from '@/shared/components/ui/tooltip';
import { TauriAppShell } from '@/shared/components/window/title-bar';
import { useConfig } from '@/shared/config/use-config';
import { REMOTE_LANGUAGE } from '@/shared/query-keys';

import { NavInputProvider } from './providers/nav-input-context';
import { ThemeProvider } from './providers/theme-context';

const queryClient = new QueryClient();

/**
 * The phone page skips the desktop shell: it has no host config, no window
 * chrome, and no business loading library or playback state.
 */
const isRemoteQueue = (): boolean => window.location.pathname === '/q';

const UpdateAutoCheck = () => {
  useUpdate();

  return null;
};

const InnerWrapper = () => (
  <>
    <MenuFocusProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MenuLayout />}>
            <Route index element={<LibraryPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="/playback" element={<Playback />} />
        </Routes>
      </BrowserRouter>
    </MenuFocusProvider>
    <Toaster />
    {UPDATES_SUPPORTED && <UpdateAutoCheck />}
  </>
);

/**
 * The phone is served by the LAN router, so it never receives the host's
 * bootstrap payload. Ask for the interface language so the remote reads the
 * same language the host selected.
 */
const RemoteLanguageSync = () => {
  const { data } = useQuery({
    queryKey: REMOTE_LANGUAGE,
    queryFn: loadInterfaceLanguage,
    retry: false,
  });

  useEffect(() => {
    if (data !== undefined) {
      syncLanguagePreference(data);
    }
  }, [data]);

  return null;
};

const RemoteShell = () => (
  <ThemeProvider defaultTheme="dark">
    <RemoteLanguageSync />
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/q" element={<RemoteQueuePage />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </TooltipProvider>
  </ThemeProvider>
);

const ThemeWrapper = () => {
  const { data: config } = useConfig();

  useEffect(() => {
    if (config !== undefined) {
      syncLanguagePreference(config.language);
    }
  }, [config]);

  return (
    <ThemeProvider defaultTheme={config?.dark_mode === false ? 'light' : 'dark'}>
      <TooltipProvider>
        <TauriAppShell>
          <InnerWrapper />
        </TauriAppShell>
      </TooltipProvider>
    </ThemeProvider>
  );
};

export const App = () => {
  useTranslation();

  return (
    <NavInputProvider>
      <QueryClientProvider client={queryClient}>
        {isRemoteQueue() ? <RemoteShell /> : <ThemeWrapper />}
      </QueryClientProvider>
    </NavInputProvider>
  );
};
