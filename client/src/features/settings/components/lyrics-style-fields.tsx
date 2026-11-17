import { useState } from 'react';

import { t } from '@/i18n';
import { Field } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';

import { DEFAULTS, LYRICS_FILL_COLORS, LYRICS_FONTS, LYRICS_OUTLINES, NAV } from './constants';
import { Hint, SettingsButtonGroup } from './settings-controls';

type Props = {
  getFocusClassName: (segment: number, slot?: number) => string;
};

/** Fill colour, outline and font of the karaoke text. */
export function LyricsStyleFields({ getFocusClassName }: Props) {
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();
  const [fillInput, setFill] = useState<string | null>(null);
  const [outlineInput, setOutline] = useState<string | null>(null);
  const [fontInput, setFont] = useState<string | null>(null);
  const fill = fillInput ?? config?.lyrics_fill_color ?? DEFAULTS.lyrics_fill_color;
  const outline = outlineInput ?? config?.lyrics_outline ?? DEFAULTS.lyrics_outline;
  const font = fontInput ?? config?.lyrics_font ?? DEFAULTS.lyrics_font;

  return (
    <>
      <Field>
        <Label>{t('settings.lyricsFillColor')}</Label>
        <Hint>{t('settings.lyricsFillColorDescription')}</Hint>
        <SettingsButtonGroup
          value={fill}
          options={LYRICS_FILL_COLORS}
          segment={NAV.playback.lyricsFillColor}
          getFocusClassName={getFocusClassName}
          onChange={(lyrics_fill_color) => {
            setFill(lyrics_fill_color);
            mutate({ lyrics_fill_color });
          }}
        />
      </Field>

      <Field>
        <Label>{t('settings.lyricsOutline')}</Label>
        <Hint>{t('settings.lyricsOutlineDescription')}</Hint>
        <SettingsButtonGroup
          value={outline}
          options={LYRICS_OUTLINES}
          segment={NAV.playback.lyricsOutline}
          getFocusClassName={getFocusClassName}
          onChange={(lyrics_outline) => {
            setOutline(lyrics_outline);
            mutate({ lyrics_outline });
          }}
        />
      </Field>

      <Field>
        <Label>{t('settings.lyricsFont')}</Label>
        <SettingsButtonGroup
          value={font}
          options={LYRICS_FONTS}
          segment={NAV.playback.lyricsFont}
          getFocusClassName={getFocusClassName}
          onChange={(lyrics_font) => {
            setFont(lyrics_font);
            mutate({ lyrics_font });
          }}
        />
      </Field>
    </>
  );
}
