import { GridSquare } from '@tearleads/ui';
import { useSettings } from '../context/SettingsProvider.js';
import { useSelectorTileSize } from '../hooks/index.js';
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

  const tileSize = useSelectorTileSize();
  const tileStyle = {
    width: `${tileSize}px`,
    minWidth: `${tileSize}px`
  };

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
            className="shrink-0"
            style={tileStyle}
          >
            <PatternPreview pattern={pattern} />
          </GridSquare>
        ))}
      </div>
    </div>
  );
}
