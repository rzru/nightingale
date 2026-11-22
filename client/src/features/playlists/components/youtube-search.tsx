import { useQuery } from '@tanstack/react-query';
import { MicIcon, RotateCcwIcon, SearchIcon, SparklesIcon } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { SEARCH_PLAYLIST_ID, searchYoutube } from '@/bridge/accounts';
import { loadSongsByHashes } from '@/bridge/songs';
import { usePlaybackLauncher } from '@/features/playback/hooks/use-playback-launcher';
import { useWishPlaylist } from '@/features/playlists/queries/use-playlists-data';
import {
  useAddYoutubeVideo,
  usePrepareWish,
} from '@/features/playlists/queries/use-playlists-mutations';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Spinner } from '@/shared/components/ui/spinner';
import { YOUTUBE_SEARCH } from '@/shared/query-keys';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { Wish } from '@/types/Wish';
import type { YoutubeSearchResult } from '@/types/YoutubeSearchResult';

import { WishStatusBadge } from './wish-status-badge';

const SEARCH_STALE_MS = 5 * 60_000;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const thumbnailUrl = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

/** Starts playback of a wish that is ready to sing. */
const useSingWish = () => {
  const { launch, reserveTarget } = usePlaybackLauncher();
  return async (fileHash: string) => {
    const target = reserveTarget();
    if (target === undefined) {
      return;
    }
    const song = (await loadSongsByHashes([fileHash])).at(0);
    if (song === undefined) {
      target?.close();
      toast.error(t('playlists.search.songMissing'));
      return;
    }
    await launch({ song, queuePlayback: false }, target);
  };
};

const AddButton = ({ result }: { result: YoutubeSearchResult }) => {
  const add = useAddYoutubeVideo();
  return (
    <Button size="sm" disabled={add.isPending} onClick={() => add.mutate(result)}>
      {add.isPending ? <Spinner /> : <SparklesIcon />}
      {t('playlists.search.add')}
    </Button>
  );
};

const RetryButton = ({ wish }: { wish: Wish }) => {
  const prepare = usePrepareWish();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={prepare.isPending}
      onClick={() => prepare.mutate(wish.id)}
    >
      <RotateCcwIcon />
      {t('common.actions.retry')}
    </Button>
  );
};

const SingButton = ({ fileHash }: { fileHash: string }) => {
  const sing = useSingWish();
  return (
    <Button size="sm" onClick={() => void sing(fileHash)}>
      <MicIcon />
      {t('playlists.search.sing')}
    </Button>
  );
};

/** Add, sing, retry, or the current preparation status. */
const ResultAction = ({ result, wish }: { result: YoutubeSearchResult; wish: Wish | null }) => {
  if (wish === null) {
    return <AddButton result={result} />;
  }
  if (wish.status === 'ready' && wish.matched_file_hash !== null) {
    return <SingButton fileHash={wish.matched_file_hash} />;
  }
  if (wish.status === 'failed') {
    return <RetryButton wish={wish} />;
  }
  return <WishStatusBadge status={wish.status} />;
};

const ResultRow = ({ result, wish }: { result: YoutubeSearchResult; wish: Wish | null }) => (
  <li className="flex items-center gap-3 rounded-lg border p-2">
    <img
      src={thumbnailUrl(result.video_id)}
      alt=""
      loading="lazy"
      className="aspect-video w-24 shrink-0 rounded-md bg-muted object-cover sm:w-32"
    />
    <div className="min-w-0 flex-1">
      <p className="truncate font-medium">{result.title}</p>
      <p className="truncate text-sm text-muted-foreground">
        {result.artist}
        {result.duration_secs !== null && ` · ${formatSeconds(result.duration_secs)}`}
      </p>
    </div>
    <div className="shrink-0">
      <ResultAction result={result} wish={wish} />
    </div>
  </li>
);

const useYoutubeSearch = () => {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const results = useQuery({
    queryKey: [...YOUTUBE_SEARCH, query],
    queryFn: async () => await searchYoutube(query),
    enabled: query !== '',
    staleTime: SEARCH_STALE_MS,
    retry: false,
  });
  // Live statuses of the songs added from search (downloads, analyses).
  const { data: added } = useWishPlaylist(SEARCH_PLAYLIST_ID);
  const live = useMemo(
    () => new Map((added?.wishes ?? []).map((wish) => [wish.external_id, wish])),
    [added],
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
  };
  return { draft, setDraft, query, results, live, submit };
};

type Search = ReturnType<typeof useYoutubeSearch>;

const SearchResults = ({ search }: { search: Search }) => {
  const { query, results, live } = search;
  if (query === '') {
    return null;
  }
  if (results.isFetching && results.data === undefined) {
    return <Spinner className="mx-auto my-4" />;
  }
  if (results.error !== null) {
    return (
      <p className="text-sm text-destructive">
        {t('playlists.search.failed', { value1: errorMessage(results.error) })}
      </p>
    );
  }
  const hits = results.data ?? [];
  if (hits.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('playlists.search.empty', { query })}</p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {hits.map((result) => (
        <ResultRow
          key={result.video_id}
          result={result}
          wish={live.get(result.video_id) ?? result.wish}
        />
      ))}
    </ul>
  );
};

/** Search any song on YouTube, then download and prepare it for karaoke. */
export const YoutubeSearch = () => {
  const search = useYoutubeSearch();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('playlists.search.title')}</CardTitle>
        <CardDescription>{t('playlists.search.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={search.submit} className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search.draft}
              onChange={(event) => search.setDraft(event.target.value)}
              placeholder={t('playlists.search.placeholder')}
              aria-label={t('playlists.search.placeholder')}
              className="pl-9"
            />
          </div>
          <Button type="submit" disabled={search.draft.trim() === ''}>
            {t('playlists.search.submit')}
          </Button>
        </form>
        <SearchResults search={search} />
      </CardContent>
    </Card>
  );
};
