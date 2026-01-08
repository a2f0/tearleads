import { SCATTER_DOT_RADIUS } from './constants';

interface CustomDotProps {
  cx?: number;
  cy?: number;
  fill?: string;
}

/** @internal Exported for testing */
export function CustomDot({ cx, cy, fill }: CustomDotProps) {
  if (cx === undefined || cy === undefined) return null;
  return <circle cx={cx} cy={cy} r={SCATTER_DOT_RADIUS} fill={fill} />;
}
