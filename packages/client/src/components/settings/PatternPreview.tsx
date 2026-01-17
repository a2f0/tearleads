import type { DesktopPatternValue } from '@/db/user-settings';

export interface PatternPreviewProps {
  pattern: DesktopPatternValue;
}

export const PATTERN_LABELS: Record<DesktopPatternValue, string> = {
  solid: 'Solid',
  honeycomb: 'Honeycomb',
  isometric: 'Isometric',
  triangles: 'Triangles',
  diamonds: 'Diamonds'
};

function HoneycombPattern() {
  return (
    <svg
      className="h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Honeycomb pattern preview"
    >
      <defs>
        <pattern
          id="honeycomb-preview"
          width="28"
          height="49"
          patternUnits="userSpaceOnUse"
          patternTransform="scale(0.5)"
        >
          <path
            d="M14 0 L28 8.08 L28 24.25 L14 32.33 L0 24.25 L0 8.08 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.15"
            strokeWidth="1"
          />
          <path
            d="M14 32.33 L28 40.41 L28 56.58 L14 64.66 L0 56.58 L0 40.41 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.15"
            strokeWidth="1"
            transform="translate(0, -16.33)"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#honeycomb-preview)" />
    </svg>
  );
}

function IsometricPattern() {
  return (
    <svg
      className="h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Isometric pattern preview"
    >
      <defs>
        <pattern
          id="isometric-preview"
          width="40"
          height="46"
          patternUnits="userSpaceOnUse"
          patternTransform="scale(0.5)"
        >
          <path
            d="M20 0 L40 11.5 L40 34.5 L20 46 L0 34.5 L0 11.5 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.12"
            strokeWidth="1"
          />
          <path
            d="M20 0 L20 23 M0 11.5 L40 11.5 M40 11.5 L20 23 M0 11.5 L20 23"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.08"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#isometric-preview)" />
    </svg>
  );
}

function TrianglesPattern() {
  return (
    <svg
      className="h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Triangles pattern preview"
    >
      <defs>
        <pattern
          id="triangles-preview"
          width="24"
          height="20"
          patternUnits="userSpaceOnUse"
          patternTransform="scale(0.6)"
        >
          <path
            d="M12 0 L24 20 L0 20 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.14"
            strokeWidth="1"
          />
          <path
            d="M12 20 L24 0 L0 0 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.08"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#triangles-preview)" />
    </svg>
  );
}

function DiamondsPattern() {
  return (
    <svg
      className="h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Diamonds pattern preview"
    >
      <defs>
        <pattern
          id="diamonds-preview"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
          patternTransform="scale(0.6)"
        >
          <path
            d="M12 0 L24 12 L12 24 L0 12 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.12"
            strokeWidth="1"
          />
          <path
            d="M12 6 L18 12 L12 18 L6 12 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.08"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#diamonds-preview)" />
    </svg>
  );
}

export function PatternPreview({ pattern }: PatternPreviewProps) {
  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex-1">
        {
          {
            solid: null,
            honeycomb: <HoneycombPattern />,
            isometric: <IsometricPattern />,
            triangles: <TrianglesPattern />,
            diamonds: <DiamondsPattern />
          }[pattern]
        }
      </div>
      <p className="bg-background py-2 text-center font-medium text-xs">
        {PATTERN_LABELS[pattern]}
      </p>
    </div>
  );
}
