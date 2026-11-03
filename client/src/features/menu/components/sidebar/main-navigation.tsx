import {
  ChevronDown,
  ChevronRight,
  Flame,
  FileQuestionMark,
  FolderIcon,
  ListMusicIcon,
  UserIcon,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';

import { ANALYSIS_STATUS_STYLES } from '@/features/library/lib/analysis-status-styles';
import { artistParents, visibleArtistAlbums } from '@/features/library/lib/artist-album-tree';
import { folderParents, visibleFolders } from '@/features/library/lib/folder-tree';
import {
  isLibraryMenuItemActive,
  libraryFilterFromMenuSelection,
  type LibraryMenuSection,
} from '@/features/library/lib/library-menu-filter';
import { useLibraryMenuItems } from '@/features/library/queries/use-library-menu-items';
import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { useSidebarArtistsExpanded } from '@/features/menu/hooks/use-sidebar-artists-expanded';
import { useSidebarFoldersExpanded } from '@/features/menu/hooks/use-sidebar-folders-expanded';
import { useSidebarSectionsOpen } from '@/features/menu/hooks/use-sidebar-sections-open';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import {
  SidebarNavProvider,
  useSidebarRowFocus,
  type SidebarNavRow,
} from '@/features/menu/providers/sidebar-nav-context';
import { t, type TranslationKey } from '@/i18n';
import { Badge } from '@/shared/components/ui/badge';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/shared/components/ui/collapsible';
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuSkeleton,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  useSidebar,
} from '@/shared/components/ui/sidebar';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { usePersistentScroll } from '@/shared/hooks/use-persistent-scroll';
import { cn } from '@/shared/utils/cn';
import type { LibraryMenuFilters } from '@/types/LibraryMenuFilters';
import type { LibraryMenuItem } from '@/types/LibraryMenuItem';

import { FolderActions } from './folder-actions';

type NavSectionConfig = {
  section: LibraryMenuSection;
  label: TranslationKey;
  icon: LucideIcon;
};

const NAV_SECTIONS: NavSectionConfig[] = [
  { section: 'hot', label: 'menu.sidebar.mainNavigation.quickFilters', icon: Flame },
  {
    section: 'no_metadata',
    label: 'menu.sidebar.mainNavigation.noMetadata',
    icon: FileQuestionMark,
  },
  { section: 'artists', label: 'menu.sidebar.mainNavigation.artists', icon: UserIcon },
  { section: 'playlists', label: 'menu.sidebar.mainNavigation.playlists', icon: ListMusicIcon },
  { section: 'folders', label: 'menu.sidebar.mainNavigation.folders', icon: FolderIcon },
];

const MENU_ITEM_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  all: 'library.bulkActionsMenu.allSongs',
  queued: 'library.songStatus.queued',
  analysed: 'library.libraryToolbar.analyzed',
  videos: 'menu.sidebar.stats.videos',
  unknown_artist: 'profiles.leaderboards.unknownArtist',
  unknown_album: 'library.songDetails.unknownAlbum',
};

// Artists, albums, folders, and playlists carry their own data label from the backend.
const menuItemLabel = (item: LibraryMenuItem): string => {
  const key = MENU_ITEM_LABEL_KEYS[item.value];
  return key === undefined ? item.label : t(key);
};

type MenuItemCountsProps = {
  item: LibraryMenuItem;
};

function MenuItemCounts({ item }: MenuItemCountsProps) {
  const segments: { label: TranslationKey; value: bigint; className: string }[] = [
    ...(item.count > 0n
      ? [
          {
            label: 'menu.sidebar.mainNavigation.total' as const,
            value: item.count,
            className: 'bg-muted text-muted-foreground',
          },
        ]
      : []),
    ...(item.queuedCount > 0n
      ? [
          {
            label: 'menu.sidebar.mainNavigation.queued' as const,
            value: item.queuedCount,
            className: ANALYSIS_STATUS_STYLES.queued,
          },
        ]
      : []),
    ...(item.analysingCount > 0n
      ? [
          {
            label: 'menu.sidebar.mainNavigation.analysing' as const,
            value: item.analysingCount,
            className: ANALYSIS_STATUS_STYLES.analysing,
          },
        ]
      : []),
    ...(item.analysedCount > 0n
      ? [
          {
            label: 'menu.sidebar.mainNavigation.analysed' as const,
            value: item.analysedCount,
            className: ANALYSIS_STATUS_STYLES.analysed,
          },
        ]
      : []),
  ];

  if (segments.length === 0) {
    return null;
  }

  return (
    <Badge
      className="h-[1.125rem] shrink-0 gap-0 overflow-hidden border border-foreground/15 bg-transparent p-0 text-[0.55rem] font-medium leading-none"
      title={segments.map(({ label, value }) => `${value} ${t(label)}`).join(', ')}
    >
      {segments.map(({ label, value, className }, index) => (
        <Fragment key={label}>
          {index > 0 && <span className="h-full w-px bg-foreground/15" />}
          <span className={`${className} flex h-full min-w-5 items-center justify-center px-1`}>
            {value.toString()}
          </span>
        </Fragment>
      ))}
    </Badge>
  );
}

type TreeNode = {
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
};

type ItemTree = {
  parents: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  onToggle: (value: string) => void;
};

const itemSection = (section: LibraryMenuSection, item: LibraryMenuItem): LibraryMenuSection =>
  section === 'artists' && item.depth === 1 ? 'albums' : section;

type LibraryNavSubItemProps = {
  section: LibraryMenuSection;
  item: LibraryMenuItem;
  filter: LibraryMenuFilters;
  onSelectItem: (section: LibraryMenuSection, item: LibraryMenuItem) => void;
  treeNode?: TreeNode;
};

type TreeToggleProps = {
  node: TreeNode;
  label: string;
};

function TreeToggle({ node, label }: TreeToggleProps) {
  if (!node.expandable) {
    return <span aria-hidden className="size-5 shrink-0" />;
  }
  return (
    <button
      type="button"
      aria-label={t(
        node.expanded ? 'menu.mainNavigation.collapseLabel' : 'menu.mainNavigation.expandLabel',
        { label },
      )}
      aria-expanded={node.expanded}
      onClick={node.onToggle}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-sidebar-foreground/70 hover:bg-sidebar-accent"
    >
      <ChevronRight
        className={cn(
          'size-3.5 transition-transform motion-reduce:transition-none',
          node.expanded && 'rotate-90',
        )}
      />
    </button>
  );
}

function LibraryNavSubItem({
  section,
  item,
  filter,
  onSelectItem,
  treeNode,
}: LibraryNavSubItemProps) {
  const { isSidebarActive, isItemFocused, itemIndex } = useSidebarRowFocus(section, item.value);
  const depth = item.depth ?? 0;
  return (
    <SidebarMenuSubItem
      className={cn(treeNode && 'flex items-center gap-0.5')}
      style={depth > 0 ? { paddingInlineStart: `${depth * 0.75}rem` } : undefined}
    >
      {treeNode && <TreeToggle node={treeNode} label={menuItemLabel(item)} />}
      <SidebarMenuButton
        data-sidebar-nav-index={itemIndex}
        isActive={isLibraryMenuItemActive(section, item, filter)}
        className={cn(
          'flex h-fit items-center justify-between gap-2 px-2 py-1.5 hover:ring-primary',
          treeNode && 'min-w-0 flex-1',
          isSidebarActive && isItemFocused && 'ring-2 ring-primary bg-sidebar-accent',
        )}
        onClick={() => onSelectItem(section, item)}
      >
        {menuItemLabel(item)}
        <MenuItemCounts item={item} />
      </SidebarMenuButton>
    </SidebarMenuSubItem>
  );
}

type LibraryNavSectionProps = {
  items: LibraryMenuItem[];
  filter: LibraryMenuFilters;
  open: boolean;
  onToggleOpen: (open: boolean) => void;
  onSelectItem: (section: LibraryMenuSection, item: LibraryMenuItem) => void;
  itemTree?: ItemTree;
} & NavSectionConfig;

function LibraryNavSection({
  section,
  label,
  icon: Icon,
  items,
  filter,
  open,
  onToggleOpen,
  onSelectItem,
  itemTree,
}: LibraryNavSectionProps) {
  const { isSidebarActive, isCollapseFocused, collapseIndex } = useSidebarRowFocus(section);

  return (
    <Collapsible open={open} onOpenChange={onToggleOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            data-sidebar-nav-index={collapseIndex}
            className={`flex w-full justify-between hover:ring-primary ${
              isSidebarActive && isCollapseFocused ? 'ring-2 ring-primary bg-sidebar-accent' : ''
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon className="size-4 shrink-0" />
              {t(label)}
            </span>
            <ChevronDown className="transition-transform group-data-[state=open]/collapsible:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 pr-0">
            {items.map((item) => {
              const sectionForItem = itemSection(section, item);
              return (
                <LibraryNavSubItem
                  key={`${sectionForItem}:${item.value}`}
                  section={sectionForItem}
                  item={item}
                  filter={filter}
                  onSelectItem={onSelectItem}
                  treeNode={
                    itemTree && {
                      expandable: itemTree.parents.has(item.value),
                      expanded: itemTree.expanded.has(item.value),
                      onToggle: () => itemTree.onToggle(item.value),
                    }
                  }
                />
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

type MainNavigationProps = {
  baseIndex: number;
  registerCallbacks: (callbacks: (() => void)[]) => void;
  folderFocusedSidebarIndex: number;
  registerFolderCallback: (callback: ((subIndex: number) => void) | null) => void;
};

export const MainNavigation = ({
  baseIndex,
  registerCallbacks,
  folderFocusedSidebarIndex,
  registerFolderCallback,
}: MainNavigationProps) => {
  const { data: menu } = useLibraryMenuItems();
  const { setOpen } = useSidebar();
  const isMobile = useIsMobile();
  const { setLibraryFilter, ...filter } = useLibraryFilter();
  const { focus } = useMenuFocus();
  const navigate = useNavigate();
  const { setScrollContainer } = usePersistentScroll('sidebar');
  const [openBySection, setOpenBySection] = useSidebarSectionsOpen();
  const [expandedArtists, setExpandedArtists] = useSidebarArtistsExpanded();
  const [expandedFolders, setExpandedFolders] = useSidebarFoldersExpanded();
  const filterRef = useLatestRef(filter);

  const selectMenuItem = useCallback(
    (section: LibraryMenuSection, item: LibraryMenuItem) => {
      setLibraryFilter((current) => ({
        ...libraryFilterFromMenuSelection(section, item),
        status: current.status,
        transcript_source: current.transcript_source,
      }));
      if (isMobile) {
        setOpen(false);
      }
      void navigate('/');
    },
    [isMobile, navigate, setLibraryFilter, setOpen],
  );

  const parentArtists = useMemo(() => artistParents(menu?.albums ?? []), [menu]);
  const parentFolders = useMemo(() => folderParents(menu?.folders ?? []), [menu]);

  const toggleArtist = useCallback(
    (value: string) => {
      setExpandedArtists((prev) => {
        const next = new Set(prev);
        if (!next.delete(value)) {
          next.add(value);
        }
        return next;
      });
    },
    [setExpandedArtists],
  );

  const toggleFolder = useCallback(
    (value: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (!next.delete(value)) {
          next.add(value);
        }
        return next;
      });
    },
    [setExpandedFolders],
  );

  // Activating a parent opens it; activating it again while selected closes it,
  // so keyboard and gamepad can fold either tree too.
  const activateMenuItem = useCallback(
    (section: LibraryMenuSection, item: LibraryMenuItem) => {
      const parents = section === 'artists' ? parentArtists : parentFolders;
      const setExpanded = section === 'artists' ? setExpandedArtists : setExpandedFolders;
      if ((section === 'artists' || section === 'folders') && parents.has(item.value)) {
        const reselected = isLibraryMenuItemActive(section, item, filterRef.current);
        setExpanded((prev) => {
          const next = new Set(prev);
          if (reselected && prev.has(item.value)) {
            next.delete(item.value);
          } else {
            next.add(item.value);
          }
          return next;
        });
      }
      selectMenuItem(section, item);
    },
    [
      filterRef,
      parentArtists,
      parentFolders,
      selectMenuItem,
      setExpandedArtists,
      setExpandedFolders,
    ],
  );

  const visibleSections = useMemo(() => {
    if (!menu) {
      return [];
    }

    return NAV_SECTIONS.map((config) => {
      const items = menu[config.section].filter(({ count }) => count > 0n);
      let visibleItems = items;
      if (config.section === 'artists') {
        visibleItems = visibleArtistAlbums(
          items,
          menu.albums.filter(({ count }) => count > 0n),
          expandedArtists,
        );
      } else if (config.section === 'folders') {
        visibleItems = visibleFolders(items, expandedFolders);
      }
      return Object.assign({}, config, { visibleItems });
    }).filter(({ visibleItems }) => visibleItems.length > 0);
  }, [menu, expandedArtists, expandedFolders]);

  const rows = useMemo<SidebarNavRow[]>(() => {
    return visibleSections.flatMap(({ section, visibleItems }) => {
      const sectionRows: SidebarNavRow[] = [{ kind: 'collapse', section }];
      if (openBySection[section]) {
        sectionRows.push(
          ...visibleItems.map((item) => ({
            kind: 'item' as const,
            section: itemSection(section, item),
            value: item.value,
          })),
        );
      }
      return sectionRows;
    });
  }, [visibleSections, openBySection]);

  useEffect(() => {
    const callbacks = rows.map((row) => {
      if (row.kind === 'collapse') {
        return () => {
          setOpenBySection((prev) => ({ ...prev, [row.section]: !prev[row.section] }));
        };
      }

      return () => {
        const item = menu?.[row.section].find((entry) => entry.value === row.value);
        if (!item) {
          return;
        }
        activateMenuItem(row.section, item);
      };
    });

    registerCallbacks(callbacks);

    return () => {
      registerCallbacks([]);
    };
  }, [rows, menu, activateMenuItem, registerCallbacks, setOpenBySection]);

  const isSidebarActive = focus.active && focus.panel === 'sidebar';

  useEffect(() => {
    if (!isSidebarActive || focus.source === 'mouse') {
      return undefined;
    }

    const rafId = requestAnimationFrame(() => {
      const focusedItem = document.querySelector<HTMLElement>(
        `[data-sidebar-nav-index="${focus.sidebarIndex}"]`,
      );
      focusedItem?.scrollIntoView({ block: 'nearest' });
    });

    return () => cancelAnimationFrame(rafId);
  }, [focus.sidebarIndex, focus.source, isSidebarActive]);

  const showEmptyPlaceholder = !menu || visibleSections.length === 0;
  const itemTrees: Partial<Record<LibraryMenuSection, ItemTree>> = {
    artists: {
      parents: parentArtists,
      expanded: expandedArtists,
      onToggle: toggleArtist,
    },
    folders: {
      parents: parentFolders,
      expanded: expandedFolders,
      onToggle: toggleFolder,
    },
  };

  return (
    <SidebarContent className="overflow-hidden">
      <FolderActions
        focusedSidebarIndex={folderFocusedSidebarIndex}
        registerCallback={registerFolderCallback}
      />
      <div
        ref={setScrollContainer}
        className="no-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        <SidebarGroup>
          <SidebarMenu>
            {showEmptyPlaceholder ? (
              <SidebarMenuItem className="px-1 py-2">
                <div className="space-y-1">
                  <SidebarMenuSkeleton showIcon />
                  <SidebarMenuSkeleton showIcon />
                  <SidebarMenuSkeleton showIcon />
                </div>
              </SidebarMenuItem>
            ) : (
              <SidebarNavProvider rows={rows} baseIndex={baseIndex}>
                {visibleSections.map((config) => (
                  <LibraryNavSection
                    key={config.section}
                    section={config.section}
                    label={config.label}
                    icon={config.icon}
                    items={config.visibleItems}
                    filter={filter}
                    open={openBySection[config.section]}
                    onToggleOpen={(open) => {
                      setOpenBySection((prev) => ({ ...prev, [config.section]: open }));
                    }}
                    onSelectItem={activateMenuItem}
                    itemTree={itemTrees[config.section]}
                  />
                ))}
              </SidebarNavProvider>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </div>
    </SidebarContent>
  );
};
