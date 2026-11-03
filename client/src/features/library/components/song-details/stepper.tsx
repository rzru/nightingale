import { MinusIcon, PlusIcon } from 'lucide-react';
import type { MouseEvent } from 'react';

import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { ButtonGroup, ButtonGroupText } from '@/shared/components/ui/button-group';
import { Spinner } from '@/shared/components/ui/spinner';

type StepperActions = {
  plus?: () => void;
  minus?: () => void;
};

type StepperDisabled = {
  plus?: boolean;
  minus?: boolean;
};

type Props = {
  ariaLabel: string;
  disabled?: StepperDisabled;
  loading?: boolean;
  label?: string | null;
  onClick?: StepperActions;
};

const NO_ACTIONS: StepperActions = {};
const NOT_DISABLED: StepperDisabled = {};

const withStopPropagation =
  (callback?: () => void) =>
  (event: MouseEvent): void => {
    event.stopPropagation();
    callback?.();
  };

export const Stepper = ({
  ariaLabel,
  label,
  loading,
  disabled: { plus: plusDisabled, minus: minusDisabled } = NOT_DISABLED,
  onClick = NO_ACTIONS,
}: Props) => {
  return (
    <ButtonGroup
      aria-label={ariaLabel}
      className="ml-auto max-w-full shrink-0"
      data-song-details-nav-group
    >
      <Button
        type="button"
        onClick={withStopPropagation(onClick.minus)}
        disabled={minusDisabled}
        variant="outline"
        size="icon-sm"
        aria-label={t('common.actions.decreaseLabel', { label: ariaLabel })}
      >
        <MinusIcon />
      </Button>
      <ButtonGroupText className="min-w-12 justify-center bg-background px-2 font-variant-numeric tabular-nums">
        {loading === true ? <Spinner className="size-3 will-change-transform" /> : (label ?? '—')}
      </ButtonGroupText>
      <Button
        type="button"
        onClick={withStopPropagation(onClick.plus)}
        disabled={plusDisabled}
        variant="outline"
        size="icon-sm"
        aria-label={t('common.actions.increaseLabel', { label: ariaLabel })}
      >
        <PlusIcon />
      </Button>
    </ButtonGroup>
  );
};
