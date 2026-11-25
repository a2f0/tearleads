import type { Quad } from "qr/decode.js";
import type {
  RecoveryKeyScanState,
  RecoveryQrFrameSize,
} from "./recoveryKeyScanState";

const GUIDE_SIDE = 0.62;
const GUIDE_CORNER = 0.18;

/** Corner brackets of a centered square that shows where to hold the code. */
function guidePath({ width, height }: RecoveryQrFrameSize): string {
  const side = Math.min(width, height) * GUIDE_SIDE;
  const arm = side * GUIDE_CORNER;
  const left = (width - side) / 2;
  const top = (height - side) / 2;
  const right = left + side;
  const bottom = top + side;
  return [
    `M${left} ${top + arm}V${top}H${left + arm}`,
    `M${right - arm} ${top}H${right}V${top + arm}`,
    `M${right} ${bottom - arm}V${bottom}H${right - arm}`,
    `M${left + arm} ${bottom}H${left}V${bottom - arm}`,
  ].join("");
}

function outlinePoints(outline: Quad): string {
  return outline.map(({ x, y }) => `${x},${y}`).join(" ");
}

/**
 * Draws over the camera preview in the decoded frame's pixel space. The SVG
 * scales like the `object-fit: contain` video beneath it, so decoder
 * coordinates line up with the picture without any conversion.
 */
export function RecoveryKeyScanOverlay({
  state,
}: {
  readonly state: RecoveryKeyScanState;
}) {
  if (state.status === "starting" || state.status === "failed") return null;
  const { frame } = state;
  const guide = guidePath(frame);
  return (
    <svg
      aria-hidden="true"
      className="recovery-key-scan-overlay"
      data-status={state.status}
      preserveAspectRatio="xMidYMid meet"
      viewBox={`0 0 ${frame.width} ${frame.height}`}
    >
      {/* A dark halo keeps the white guide visible over bright paper. */}
      <path className="recovery-key-scan-guide-halo" d={guide} />
      <path className="recovery-key-scan-guide" d={guide} />
      {state.status !== "searching" && state.outline && (
        <polygon
          className="recovery-key-scan-outline"
          points={outlinePoints(state.outline)}
        />
      )}
    </svg>
  );
}
