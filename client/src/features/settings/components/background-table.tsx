import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import type { CustomBackground } from '@/types/CustomBackground';

function sourceLabel(background: CustomBackground): string {
  return t(
    background.source.kind === 'url'
      ? 'settings.backgrounds.linkSource'
      : 'settings.backgrounds.uploadedSource',
  );
}

export function BackgroundTable({
  backgrounds,
  busy,
  pendingRemoval,
  getFocusClassName,
  onRemove,
}: {
  backgrounds: readonly CustomBackground[];
  busy: boolean;
  pendingRemoval: string | null;
  getFocusClassName: (index: number) => string | undefined;
  onRemove: (id: string) => void;
}) {
  if (backgrounds.length === 0) {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-lg border">
        <p className="text-sm text-muted-foreground">
          {t('settings.backgroundTable.noCustomBackgroundsYet')}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-y-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead>{t('settings.backgroundTable.name')}</TableHead>
            <TableHead>{t('settings.backgroundTable.type')}</TableHead>
            <TableHead>{t('settings.backgroundTable.source')}</TableHead>
            <TableHead className="text-right">{t('settings.backgroundTable.action')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {backgrounds.map((background, index) => (
            <TableRow key={background.id}>
              <TableCell className="max-w-64 truncate font-medium">{background.name}</TableCell>
              <TableCell className="capitalize">{background.background_type}</TableCell>
              <TableCell>{sourceLabel(background)}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant={pendingRemoval === background.id ? 'destructive' : 'outline'}
                  size="sm"
                  disabled={busy}
                  className={getFocusClassName(index)}
                  onClick={() => onRemove(background.id)}
                >
                  {t(
                    pendingRemoval === background.id
                      ? 'settings.backgrounds.confirmRemove'
                      : 'common.actions.remove',
                  )}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
