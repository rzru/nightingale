import { t, type TranslationKey } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

const presets: readonly { value: string; key: TranslationKey }[] = [
  { value: '#ffffff', key: 'videoExport.colors.white' },
  { value: '#ffd700', key: 'videoExport.colors.gold' },
  { value: '#ef4444', key: 'videoExport.colors.red' },
  { value: '#22c55e', key: 'videoExport.colors.green' },
  { value: '#38bdf8', key: 'videoExport.colors.blue' },
  { value: '#a855f7', key: 'videoExport.colors.purple' },
];

export function VideoColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-1">{label}</legend>
      <Input
        type="color"
        className="h-10"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {presets.map((preset) => (
          <Button
            key={preset.value}
            type="button"
            variant="outline"
            className="h-11 min-w-0 px-1 aria-pressed:ring-2 aria-pressed:ring-primary"
            aria-pressed={value.toLowerCase() === preset.value}
            onClick={() => onChange(preset.value)}
          >
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full border"
              style={{ backgroundColor: preset.value }}
            />
            <span>{t(preset.key)}</span>
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
