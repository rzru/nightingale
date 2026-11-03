import { Fragment, type ReactNode } from 'react';

import { translationTemplate, useLocale, type TranslationKey } from './index';

export const Trans = ({
  id,
  values,
}: {
  id: TranslationKey;
  values: Record<string, ReactNode>;
}) => {
  useLocale();

  const occurrences = new Map<string, number>();

  return translationTemplate(id)
    .split(/(\{\{\w+\}\})/g)
    .filter(Boolean)
    .map((part) => {
      const name = /^\{\{(\w+)\}\}$/.exec(part)?.[1];
      if (name === undefined) {
        return part;
      }

      const occurrence = occurrences.get(name) ?? 0;
      occurrences.set(name, occurrence + 1);

      return (
        <Fragment key={`${name}-${occurrence}`}>
          {Object.hasOwn(values, name) ? values[name] : part}
        </Fragment>
      );
    });
};
