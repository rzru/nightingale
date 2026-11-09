import { useQuery } from '@tanstack/react-query';

import { loadNodeDirectory, probeNode, ROOMS_PROTOCOL, type NodeInfo } from '@/bridge/rooms';

import { loadKnownNodes } from '../lib/known-nodes';

export type RoomNode = {
  added: boolean;
  info: NodeInfo;
  name: string;
  rttMs: number | null;
  url: string;
};

export const ROOMS_NODES = ['rooms-nodes'];

/**
 * Merge the shared node directory with nodes the user added, probe all of them,
 * and keep only reachable nodes that speak our protocol.
 */
const loadNodes = async (): Promise<RoomNode[]> => {
  const [directory, known] = [await loadNodeDirectory(), loadKnownNodes()];
  const knownUrls = new Set(known);
  const directoryNames = new Map(directory.map((entry) => [entry.url, entry.name]));
  const urls = [...new Set([...known, ...directory.map((entry) => entry.url)])];
  const probes = await Promise.all(urls.map((url) => probeNode(url)));

  return probes.flatMap((probe) => {
    if (probe.info === null || probe.info.protocol !== ROOMS_PROTOCOL) {
      return [];
    }

    return [
      {
        url: probe.url,
        name: directoryNames.get(probe.url) ?? probe.info.name,
        info: probe.info,
        rttMs: probe.rttMs,
        added: knownUrls.has(probe.url),
      },
    ];
  });
};

export const useNodes = () =>
  useQuery({ queryKey: ROOMS_NODES, queryFn: loadNodes, staleTime: 15_000 });
