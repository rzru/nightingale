import prettyBytes from 'pretty-bytes';

import { t } from '@/i18n';
import { Progress } from '@/shared/components/ui/progress';

import { GENERIC_DESCRIPTION, type ViewParts } from '../parts';

type Args = {
  downloaded: number;
  contentLength: number | null;
  version: string;
};

export const downloadingView = ({ downloaded, contentLength, version }: Args): ViewParts => {
  const percent =
    typeof contentLength === 'number' && contentLength !== 0 && contentLength > 0
      ? Math.min(100, Math.floor((downloaded / contentLength) * 100))
      : null;

  const sizeLabel =
    typeof contentLength === 'number' && contentLength !== 0
      ? `${prettyBytes(downloaded)} of ${prettyBytes(contentLength)}${
          percent !== null ? ` (${percent}%)` : ''
        }`
      : prettyBytes(downloaded);

  return {
    description: GENERIC_DESCRIPTION,
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {t('updates.downloading.downloadingValue1', { value1: version })}
        </p>
        <Progress value={percent ?? 0} max={100} />
        <p className="text-xs text-muted-foreground">{sizeLabel}</p>
      </div>
    ),
    footer: null,
  };
};
