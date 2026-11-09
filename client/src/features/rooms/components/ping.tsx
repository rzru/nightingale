import { cn } from '@/shared/utils/cn';

type PingTone = 'good' | 'ok' | 'poor';

const TONE_CLASS: Record<PingTone, string> = {
  good: 'bg-primary',
  ok: 'bg-primary/50',
  poor: 'bg-destructive',
};

/**
 * Ping is the round trip of one `GET /api/node`, so the levels are honest:
 * under ~80 ms feels instant, past 200 ms the countdown will drift.
 */
const pingTone = (rttMs: number | null): PingTone => {
  if (rttMs === null) {
    return 'ok';
  }

  if (rttMs < 80) {
    return 'good';
  }

  return rttMs < 200 ? 'ok' : 'poor';
};

export const Ping = ({ rttMs }: { rttMs: number | null }) => (
  <span className="inline-flex items-center gap-1.5 tabular-nums">
    <span
      className={cn('size-1.5 shrink-0 rounded-full', TONE_CLASS[pingTone(rttMs)])}
      aria-hidden="true"
    />
    {rttMs ?? 0} ms
  </span>
);

/** Version is metadata, not prose: a chip keeps it from reading as a sentence. */
export const NodeVersion = ({ version }: { version: string }) => (
  <span className="rounded-sm border border-border px-1 py-px text-[10px] leading-none tabular-nums">
    v{version}
  </span>
);
