import { GridSquare } from '@tearleads/ui';
import { useSettings } from '../context/SettingsProvider.js';
import type { DesktopPatternValue } from '../types/userSettings.js';
import { PatternPreview } from './PatternPreview.js';

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
        className="flex gap-3 overflow-x-auto p-0.5 md:overflow-visible"
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
