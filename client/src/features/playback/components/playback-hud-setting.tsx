import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Kbd } from '@/shared/components/ui/kbd';
import { cn } from '@/shared/utils/cn';

export function ShortcutKeys({ keys }: { keys: string[] }) {
  return keys.map((key) => (
    <Kbd key={key} className="h-4 min-w-4 bg-white/15 font-sans text-white/70">
      {key}
    </Kbd>
  ));
}

export function HudSettingValue({ children }: { children: ReactNode }) {
  return <span className="text-xs text-white/70 tabular-nums">{children}</span>;
}

export function HudSetting({
  icon: Icon,
  label,
  trailing,
  shortcut,
  compact = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  trailing?: ReactNode;
  shortcut?: ReactNode;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className={cn('flex min-w-0 flex-1 flex-col', compact ? 'gap-0.5' : 'gap-2')}>
        <div className="flex items-center gap-2 text-xs text-white/60">
          <Icon className="size-3.5 shrink-0" aria-hidden="true" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">{label}</span>
          {trailing}
        </div>
        {children}
      </div>
      {shortcut !== undefined && (
        <>
          <div className="w-px shrink-0 self-stretch bg-white/20" aria-hidden="true" />
          <div className="flex w-14 shrink-0 items-center justify-end gap-1">{shortcut}</div>
        </>
      )}
    </div>
  );
}
