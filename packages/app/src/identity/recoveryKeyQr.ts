import encodeQR from "qr";

/**
 * The recovery key as a QR code's SVG markup. Uppercased so the encoder picks
 * alphanumeric mode, whose larger modules are easier for a camera to scan; a scan
 * normalizes the case back before restoring.
 */
export function recoveryKeyQrSvg(seedPhrase: string): string {
  return encodeQR(seedPhrase.toUpperCase(), "svg", {
    border: 4,
    ecc: "medium",
  });
}
