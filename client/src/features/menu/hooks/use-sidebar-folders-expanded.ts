import { atom, useAtom } from 'jotai';

const sidebarFoldersExpandedAtom = atom<ReadonlySet<string>>(new Set<string>());

export function useSidebarFoldersExpanded() {
  return useAtom(sidebarFoldersExpandedAtom);
}
