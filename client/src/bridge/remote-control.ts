import { z } from 'zod';

import { invoke, isTauri } from './runtime';

const remoteInfoSchema = z.object({
  url: z.string().nullable(),
  qrSvg: z.string().nullable(),
});

export type RemoteInfo = z.infer<typeof remoteInfoSchema>;

const parse = (value: unknown): RemoteInfo => remoteInfoSchema.parse(value);

/**
 * Describes the LAN queue link for this host. Tauri asks its own local server,
 * the self-hosted build asks the server it is already talking to.
 */
export const loadRemoteInfo = async (): Promise<RemoteInfo> => {
  if (isTauri) {
    return parse(await invoke('remote_control_info'));
  }

  const response = await fetch('/api/remote');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parse(await response.json());
};
