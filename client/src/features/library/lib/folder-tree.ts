import type { LibraryMenuItem } from '@/types/LibraryMenuItem';

const depthOf = (item: LibraryMenuItem | undefined): number => item?.depth ?? 0;

/** Values of folder items that have subfolders. Items are in depth-first order. */
export function folderParents(items: readonly LibraryMenuItem[]): ReadonlySet<string> {
  return new Set(
    items
      .filter((item, index) => depthOf(items[index + 1]) > depthOf(item))
      .map((item) => item.value),
  );
}

/** Folder items not hidden inside a collapsed ancestor. */
export function visibleFolders(
  items: readonly LibraryMenuItem[],
  expanded: ReadonlySet<string>,
): LibraryMenuItem[] {
  const visible: LibraryMenuItem[] = [];
  let collapsedDepth: number | null = null;
  items.forEach((item, index) => {
    const depth = depthOf(item);
    if (collapsedDepth !== null && depth > collapsedDepth) {
      return;
    }
    collapsedDepth = null;
    visible.push(item);
    if (depthOf(items[index + 1]) > depth && !expanded.has(item.value)) {
      collapsedDepth = depth;
    }
  });
  return visible;
}
