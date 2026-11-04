import { TransportControls } from '@/features/playback/components/playback-transport-controls';
import type { RemoteTransport } from '@/features/remote/hooks/use-remote-playback';

type RemoteTransportBarProps = {
  transport: RemoteTransport;
};

/** The host HUD's seek slider and buttons, driven by the host's published clock. */
export function RemoteTransportBar({ transport }: RemoteTransportBarProps) {
  return (
    <TransportControls
      duration={transport.duration}
      subscribe={transport.subscribe}
      getCurrentTime={transport.getCurrentTime}
      seek={transport.seek}
      lines={transport.lines}
      className="max-w-none"
    />
  );
}
