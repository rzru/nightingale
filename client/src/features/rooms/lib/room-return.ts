import { z } from 'zod';

import type { RoomSession } from '../hooks/use-room';

/**
 * Navigation contract between the playback surface and the rooms page. Room
 * playback returns here after a song so the same seat can keep singing.
 */
const roomReturnSchema = z.object({
  roomSession: z.object({
    nodeUrl: z.string().min(1),
    joining: z.object({
      roomId: z.string().min(1),
      memberId: z.string().min(1),
      token: z.string().min(1),
    }),
  }),
});

export const roomReturnState = (session: RoomSession): unknown => ({ roomSession: session });

export const readRoomReturn = (state: unknown): RoomSession | null => {
  const parsed = roomReturnSchema.safeParse(state);

  return parsed.success ? parsed.data.roomSession : null;
};
