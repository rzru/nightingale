import type { TranslationKey } from '@/i18n';

const MESSAGES: Record<string, TranslationKey> = {
  'at-capacity': 'rooms.deny.atCapacity',
  'color-taken': 'rooms.deny.colorTaken',
  'bad-password': 'rooms.deny.badPassword',
  denied: 'rooms.deny.denied',
  full: 'rooms.deny.full',
  'in-playback': 'rooms.deny.inPlayback',
  'no-track': 'rooms.deny.noTrack',
  'not-found': 'rooms.deny.notFound',
  'not-host': 'rooms.deny.notHost',
  'not-pauser': 'rooms.deny.notPauser',
  'not-ready': 'rooms.deny.notReady',
  'rate-limited': 'rooms.deny.rateLimited',
  'track-unset': 'rooms.deny.trackUnset',
};

/** Maps both socket denials and HTTP reasons onto one message catalog. */
export const denyMessage = (reason: string): TranslationKey =>
  Object.hasOwn(MESSAGES, reason) ? MESSAGES[reason] : 'rooms.deny.unknown';
