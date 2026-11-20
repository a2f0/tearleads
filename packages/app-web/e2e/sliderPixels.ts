import type { Locator } from "@playwright/test";

/** Sample a horizontal slider at its latest (rightmost) version. */
export async function sliderPixels(slider: Locator) {
  const screenshot = await slider.screenshot({ scale: "css" });
  return slider.evaluate(async (_, png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot read slider screenshot");
    context.drawImage(image, 0, 0);
    const color = (x: number, y: number) => {
      const [r, g, b] = context.getImageData(x, y, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };
    return {
      background: color(image.width / 2, 2),
      track: color(image.width / 2, image.height / 2),
      thumb: color(image.width - 8, image.height / 2),
    };
  }, screenshot.toString("base64"));
}
