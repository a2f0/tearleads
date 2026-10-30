import type { Locator } from "@playwright/test";

/** Inspect the actual SVG mask and theme colors painted by the host. */
export function wallpaperPixels(wallpaper: Locator) {
  return wallpaper.evaluate(async (element) => {
    const style = getComputedStyle(element);
    const inkStyle = getComputedStyle(element, "::before");
    const url = inkStyle.maskImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    if (!url) {
      throw new Error("Wallpaper has no SVG mask");
    }
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    // Four samples per CSS pixel distinguish an abrupt cut from antialiasing.
    canvas.width = image.naturalWidth * 4;
    canvas.height = image.naturalHeight * 4;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Cannot inspect the wallpaper pixels");
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = (x: number, y: number) =>
      pixels[(y * canvas.width + x) * 4 + 3] ?? 0;
    let horizontalSeam = 0;
    let verticalSeam = 0;
    let minimum = 255;
    let maximum = 0;
    for (let y = 0; y < canvas.height; y++) {
      horizontalSeam += Math.abs(alpha(0, y) - alpha(canvas.width - 1, y));
      for (let x = 0; x < canvas.width; x++) {
        minimum = Math.min(minimum, alpha(x, y));
        maximum = Math.max(maximum, alpha(x, y));
      }
    }
    for (let x = 0; x < canvas.width; x++) {
      verticalSeam += Math.abs(alpha(x, 0) - alpha(x, canvas.height - 1));
    }
    const color = (css: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    };
    const base = color(style.backgroundColor);
    const ink = color(inkStyle.backgroundColor);
    const foreground = color(style.getPropertyValue("--color-dark"));
    const luminance = (rgb: number[]) =>
      rgb.reduce((sum, value, index) => {
        const channel = value / 255;
        const linear =
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
      }, 0);
    const contrast = (opacity: number) => {
      const background = luminance(
        base.map(
          (value, index) => value + ((ink[index] ?? value) - value) * opacity,
        ),
      );
      const text = luminance(foreground);
      return (
        (Math.max(background, text) + 0.05) /
        (Math.min(background, text) + 0.05)
      );
    };
    return {
      horizontalSeam: horizontalSeam / canvas.height,
      verticalSeam: verticalSeam / canvas.width,
      minimumAlpha: minimum / 255,
      maximumAlpha: maximum / 255,
      baseLuminance: luminance(base),
      minimumContrast: Math.min(
        contrast(minimum / 255),
        contrast(maximum / 255),
      ),
      base: style.backgroundColor,
      ink: inkStyle.backgroundColor,
    };
  });
}
