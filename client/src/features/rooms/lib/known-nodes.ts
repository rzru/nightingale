/**
 * Nodes the user added by URL. This is a local session preference, so it lives
 * in web storage instead of the shared `config.json` the node never sees.
 */

const NODES_KEY = 'nightingale.rooms.nodes';
const MAX_NODES = 20;

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private browsing, quota); the value then just
    // does not survive a restart.
  }
};

export const loadKnownNodes = (): string[] => {
  const raw = read(NODES_KEY);

  if (raw === null) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
};

export const rememberNode = (url: string): string[] => {
  const nodes = [url, ...loadKnownNodes().filter((known) => known !== url)].slice(0, MAX_NODES);
  write(NODES_KEY, JSON.stringify(nodes));

  return nodes;
};

export const forgetNode = (url: string): string[] => {
  const nodes = loadKnownNodes().filter((known) => known !== url);
  write(NODES_KEY, JSON.stringify(nodes));

  return nodes;
};
