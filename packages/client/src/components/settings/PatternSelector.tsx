import { GridSquare } from '@/components/ui/grid-square';
import { useSettings } from '@/db/SettingsProvider';
import type { DesktopPatternValue } from '@/db/user-settings';
import { PatternPreview } from './PatternPreview';

const PATTERNS: DesktopPatternValue[] = [
  'solid',
  'honeycomb',
  'isometric',
  'triangles',
  'diamonds'
];

export function PatternSelector() {
  const { getSetting, setSetting } = useSettings();
  const currentPattern = getSetting('desktopPattern');

  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">Desktop Pattern</p>
        <p className="text-muted-foreground text-sm">
          Choose a background pattern for the home screen
        </p>
      </div>
      <div
        className="flex gap-3 overflow-x-auto md:overflow-visible"
        data-testid="pattern-selector-container"
      >
        {PATTERNS.map((pattern) => (
          <GridSquare
            key={pattern}
            onClick={() => setSetting('desktopPattern', pattern)}
            selected={currentPattern === pattern}
            data-testid={`pattern-option-${pattern}`}
            className="w-[100px] shrink-0 md:w-[200px]"
          >
            <PatternPreview pattern={pattern} />
          </GridSquare>
        ))}
      </div>
    </div>
  );
}
