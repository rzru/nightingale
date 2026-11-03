import { CheckCircle2Icon } from 'lucide-react';

import { t } from '@/i18n';

import {
  CURRENT_VERSION,
  GENERIC_DESCRIPTION,
  InfoLine,
  PairFooter,
  type FocusCtx,
  type ViewParts,
} from '../parts';

type Args = {
  ctx: FocusCtx;
  onClose: () => void;
  onRefetch: () => void;
};

export const upToDateView = ({ ctx, onClose, onRefetch }: Args): ViewParts => ({
  description: GENERIC_DESCRIPTION,
  body: (
    <InfoLine icon={CheckCircle2Icon}>
      {t('updates.upToDate.youReOnTheLatestDescription', { value1: CURRENT_VERSION })}
    </InfoLine>
  ),
  footer: (
    <PairFooter
      ctx={ctx}
      onClose={onClose}
      primaryLabel="updates.actions.checkAgain"
      onPrimary={onRefetch}
    />
  ),
});
