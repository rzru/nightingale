export const FLAVORS = ['nature', 'underwater', 'space', 'city', 'countryside'] as const;

export type VideoFlavor = (typeof FLAVORS)[number];

export function isVideoFlavor(value: string): value is VideoFlavor {
  return FLAVORS.some((flavor) => flavor === value);
}

export function videoFlavorLabel(flavor: VideoFlavor): string {
  return flavor.charAt(0).toUpperCase() + flavor.slice(1);
}

export function getNextFlavor(flavor: VideoFlavor): VideoFlavor {
  const index = FLAVORS.indexOf(flavor);

  return FLAVORS[(index + 1) % FLAVORS.length];
}
