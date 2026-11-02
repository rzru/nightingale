type DisplayPlayer = {
  id: string;
  profile: string | null;
};

export function playerDisplayName(
  player: DisplayPlayer,
  players: readonly DisplayPlayer[],
): string {
  if (player.profile !== null) {
    return player.profile;
  }

  const guests = players
    .filter(({ profile }) => profile === null)
    .toSorted((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  if (guests.length === 1) {
    return 'Guest';
  }

  return `Guest ${guests.findIndex(({ id }) => id === player.id) + 1}`;
}
