import './app.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router';

import { UPDATES_SUPPORTED } from '@/bridge/platform';
import { DeepLinkListener } from '@/features/deep-link/deep-link-listener';
import { LibraryPage } from '@/features/library/library-page';
import { MenuLayout } from '@/features/menu/menu';
import { MenuFocusProvider } from '@/features/menu/providers/menu-focus-context';
import { Playback } from '@/features/playback/playback';
import { SettingsPage } from '@/features/settings/settings';
import { useUpdate } from '@/features/updates/queries/use-update';
import { Toaster } from '@/shared/components/ui/sonner';
import { TooltipProvider } from '@/shared/components/ui/tooltip';
import { TauriAppShell } from '@/shared/components/window/title-bar';
import { useConfig } from '@/shared/config/use-config';

import { NavInputProvider } from './providers/nav-input-context';
import { ThemeProvider } from './providers/theme-context';

const queryClient = new QueryClient();

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
    <DeepLinkListener />
    <Toaster />
    {UPDATES_SUPPORTED && <UpdateAutoCheck />}
  </>
);

const ThemeWrapper = () => {
  const { data: config } = useConfig();

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

export const App = () => (
  <NavInputProvider>
    <QueryClientProvider client={queryClient}>
      <ThemeWrapper />
    </QueryClientProvider>
  </NavInputProvider>
);
