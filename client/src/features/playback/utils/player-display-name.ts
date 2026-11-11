import { t } from '@/i18n';

type DisplayPlayer = {
  id: string;
  /** Room singers carry a member name instead of a profile. */
  name?: string | null;
  profile: string | null;
};

export function playerDisplayName(
  player: DisplayPlayer,
  players: readonly DisplayPlayer[],
): string {
  if (player.profile !== null) {
    return player.profile;
  }

  if (player.name !== null && player.name !== undefined && player.name !== '') {
    return player.name;
  }

  const guests = players
    .filter(({ profile }) => profile === null)
    .toSorted((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  if (guests.length === 1) {
    return t('playback.players.guest');
  }

  return t('playback.players.numberedGuest', {
    number: guests.findIndex(({ id }) => id === player.id) + 1,
  });
}
