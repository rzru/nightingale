import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { DialogFooter } from '@/shared/components/ui/dialog';
import { cn } from '@/shared/utils/cn';

import { version as currentVersion } from '../../../../package.json';

export const CURRENT_VERSION = currentVersion;
export const RELEASES_URL = 'https://github.com/rzru/nightingale/releases/latest';
export const SELF_HOSTED_DOCS_URL = 'https://nightingale.cafe/docs/self-hosted.html#updating';
export const GENERIC_DESCRIPTION = 'Keep Nightingale up to date with the latest improvements.';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

export type FocusCtx = {
  open: boolean;
  focusedIndex: number;
};

export type ViewParts = {
  description: string;
  body: ReactNode;
  footer: ReactNode | null;
};

export const ringFor = (ctx: FocusCtx, idx: number) =>
  cn(NO_FOCUS_RING, ctx.open && ctx.focusedIndex === idx && RING);

type SoloFooterProps = {
  ctx: FocusCtx;
  label: string;
  onClick: () => void;
};

export const SoloFooter = ({ ctx, label, onClick }: SoloFooterProps) => (
  <DialogFooter>
    <Button onClick={onClick} className={ringFor(ctx, 0)}>
      {t(label)}
    </Button>
  </DialogFooter>
);

type PairFooterProps = {
  ctx: FocusCtx;
  closeLabel?: string;
  onClose: () => void;
  primaryLabel: string;
  primaryIcon?: LucideIcon;
  onPrimary: () => void;
};

export const PairFooter = ({
  ctx,
  closeLabel = 'common.actions.close',
  onClose,
  primaryLabel,
  primaryIcon: Icon,
  onPrimary,
}: PairFooterProps) => (
  <DialogFooter>
    <Button variant="outline" onClick={onClose} className={ringFor(ctx, 0)}>
      {t(closeLabel)}
    </Button>
    <Button onClick={onPrimary} className={ringFor(ctx, 1)}>
      {Icon && <Icon />}
      {t(primaryLabel)}
    </Button>
  </DialogFooter>
);

export const InfoLine = ({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) => (
  <p className="flex items-start gap-2 text-xs text-muted-foreground">
    <Icon className="size-4 shrink-0 mt-0.5" />
    <span>{children}</span>
  </p>
);
