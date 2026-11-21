type Rgb = readonly [number, number, number];

const RGB_PATTERN =
  /^rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, ([\d.]+))?\)$/u;
// Chromium serializes a `color-mix(in srgb, …)` result in the `color()` form,
// with unit channels instead of 0-255 ones.
const SRGB_PATTERN =
  /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/u;

function opaque(value: string, alpha: string | undefined): void {
  if (alpha !== undefined && Number(alpha) !== 1) {
    throw new Error(`Expected an opaque computed color, got "${value}".`);
  }
}

// Parse an opaque computed color into 0-255 sRGB channels.
function parseOpaqueRgb(value: string): Rgb {
  const rgb = RGB_PATTERN.exec(value);
  if (rgb) {
    opaque(value, rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  const srgb = SRGB_PATTERN.exec(value);
  if (srgb) {
    opaque(value, srgb[4]);
    return [
      Number(srgb[1]) * 255,
      Number(srgb[2]) * 255,
      Number(srgb[3]) * 255,
    ];
  }
  throw new Error(`Expected an opaque computed color, got "${value}".`);
}

function linearChannel(channel: number): number {
  const unit = channel / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([red, green, blue]: Rgb): number {
  return (
    0.2126 * linearChannel(red) +
    0.7152 * linearChannel(green) +
    0.0722 * linearChannel(blue)
  );
}

/** WCAG contrast ratio between two opaque computed colors. */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(parseOpaqueRgb(first));
  const b = relativeLuminance(parseOpaqueRgb(second));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
