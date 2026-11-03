import { ChevronRightIcon, CoffeeIcon, HeartIcon, RepeatIcon } from 'lucide-react';
import { useEffect, useRef, type ComponentType, type SVGProps } from 'react';

import { openUrl } from '@/bridge/opener';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useDonationSeen } from '@/features/menu/hooks/use-donation-seen';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { cn } from '@/shared/utils/cn';

const PATREON_URL = 'https://www.patreon.com/cw/nightingalekaraoke';
const KOFI_URL = 'https://ko-fi.com/nightingalekaraoke';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

type DonationCardProps = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  cta: string;
  href: string;
  focused: boolean;
  onHover: () => void;
};

const DonationCard = ({
  icon: Icon,
  title,
  description,
  cta,
  href,
  focused,
  onHover,
}: DonationCardProps) => (
  <button
    type="button"
    onClick={() => void openUrl(href)}
    onMouseEnter={onHover}
    className={cn(
      'group flex w-full items-start gap-3 rounded-md border border-foreground/10 bg-muted/30 p-3 text-left transition-colors',
      'hover:bg-muted/60 hover:border-pink-500/40',
      NO_FOCUS_RING,
      focused && RING,
    )}
  >
    <Icon className="mt-0.5 size-4 shrink-0 text-pink-500" />
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-xs font-medium">{title}</p>
      <p className="text-[0.7rem] text-muted-foreground">{description}</p>
      <p className="mt-1 inline-flex items-center gap-1 text-[0.7rem] leading-none font-medium text-pink-500">
        <span>{cta}</span>
        <ChevronRightIcon className="size-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </p>
    </div>
  </button>
);

export const DonateDialog = () => {
  const { mode, close } = useDialog();
  const { markSeen } = useDonationSeen();

  const open = mode === 'donate';

  const containerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (justOpened) {
      markSeen();
    }
  }, [open, markSeen]);

  const { focusedIndex, focusSegment } = useDialogNav({
    open,
    itemCount: 3,
    onBack: close,
    containerRef,
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <div ref={containerRef} className="contents">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HeartIcon className="size-4 text-pink-500" />
              {t('menu.donate.supportNightingale')}
            </DialogTitle>
            <DialogDescription>
              {t('menu.donate.nightingaleIsOpenSourceFreeDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <DonationCard
              icon={RepeatIcon}
              title={t('menu.donate.recurringOnPatreon')}
              description={t('menu.donate.backTheProjectEveryMonthDescription')}
              cta={t('menu.donate.supportOnPatreon')}
              href={PATREON_URL}
              focused={open && focusedIndex === 0}
              onHover={() => focusSegment(0)}
            />
            <DonationCard
              icon={CoffeeIcon}
              title={t('menu.donate.oneOffOnKoFi')}
              description={t('menu.donate.dropAOneTimeTipDescription')}
              cta={t('menu.donate.buyCoffee')}
              href={KOFI_URL}
              focused={open && focusedIndex === 1}
              onHover={() => focusSegment(1)}
            />
          </div>
          <DialogFooter className="sm:justify-end">
            <Button
              variant="outline"
              onClick={close}
              onMouseEnter={() => focusSegment(2)}
              className={cn(NO_FOCUS_RING, open && focusedIndex === 2 && RING)}
            >
              {t('common.actions.close')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
