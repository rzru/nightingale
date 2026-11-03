import { RemoteSourceConnectDialog } from '@/features/sources/components/connect';
import {
  useConnectJellyfin,
  useJellyfinLogin,
} from '@/features/sources/mutations/use-source-mutations';
import { t } from '@/i18n';

export const JellyfinConnectDialog = () => {
  const loginMutation = useJellyfinLogin();
  const connectMutation = useConnectJellyfin();

  return (
    <RemoteSourceConnectDialog
      mode="jellyfin-connect"
      title={t('sources.jellyfinConnect.connectToJellyfin')}
      description={<>{t('sources.jellyfinConnect.pointNightingaleAtAJellyfinDescription')}</>}
      urlInputId="jelly-url"
      urlPlaceholder="https://jellyfin.example.com"
      usernameInputId="jelly-user"
      passwordInputId="jelly-pass"
      loginMutation={loginMutation}
      connectMutation={connectMutation}
      selection={{
        label: 'sources.jellyfinConnect.librariesToImport',
        emptyMessage: 'sources.jellyfinConnect.thisServerDidnTReportDescription',
        getItems: (login) =>
          login.libraries.map((library) => ({ id: library.id, label: library.name })),
      }}
    />
  );
};
