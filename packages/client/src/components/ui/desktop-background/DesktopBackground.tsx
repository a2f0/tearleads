import type { ReactNode } from 'react';
import { useSettings } from '@/db/SettingsProvider';
import type { DesktopPatternValue } from '@/db/user-settings';

function HoneycombSvg() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="honeycomb-bg"
          width="56"
          height="100"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M28 0 L56 16.16 L56 48.5 L28 64.66 L0 48.5 L0 16.16 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.06"
            strokeWidth="1"
          />
          <path
            d="M28 64.66 L56 80.82 L56 113.16 L28 129.32 L0 113.16 L0 80.82 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.06"
            strokeWidth="1"
            transform="translate(0, -32.33)"
          />
          <path
            d="M0 0 L28 16.16 L28 48.5 L0 64.66 L-28 48.5 L-28 16.16 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.06"
            strokeWidth="1"
            transform="translate(0, 32.33)"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#honeycomb-bg)" />
    </svg>
  );
}

function IsometricSvg() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="isometric-bg"
          width="80"
          height="92"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M40 0 L80 23 L80 69 L40 92 L0 69 L0 23 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.05"
            strokeWidth="1"
          />
          <path
            d="M40 0 L40 46 M0 23 L80 23 M80 23 L40 46 M0 23 L40 46"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.04"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#isometric-bg)" />
    </svg>
  );
}

const PATTERN_COMPONENTS: Record<
  Exclude<DesktopPatternValue, 'solid'>,
  () => ReactNode
> = {
  honeycomb: HoneycombSvg,
  isometric: IsometricSvg
};

export function DesktopBackground() {
  const { getSetting } = useSettings();
  const pattern = getSetting('desktopPattern');

  if (pattern === 'solid') {
    return null;
  }

  const PatternComponent = PATTERN_COMPONENTS[pattern];
  return (
    <div
      className="pointer-events-none absolute inset-0 text-foreground"
      aria-hidden="true"
    >
      <PatternComponent />
    </div>
  );
}
