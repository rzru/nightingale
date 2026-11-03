import { RemoteSourceConnectDialog } from '@/features/sources/components/connect';
import {
  useConnectNavidrome,
  useNavidromeLogin,
} from '@/features/sources/mutations/use-source-mutations';
import { t } from '@/i18n';

export const NavidromeConnectDialog = () => {
  const loginMutation = useNavidromeLogin();
  const connectMutation = useConnectNavidrome();

  return (
    <RemoteSourceConnectDialog
      mode="navidrome-connect"
      title={t('sources.navidromeConnect.connectToNavidrome')}
      description={<>{t('sources.navidromeConnect.pointNightingaleAtANavidromeDescription')}</>}
      urlInputId="navi-url"
      urlPlaceholder="https://navidrome.example.com"
      usernameInputId="navi-user"
      passwordInputId="navi-pass"
      loginMutation={loginMutation}
      connectMutation={connectMutation}
    />
  );
};
