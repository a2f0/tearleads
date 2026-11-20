import type { Locator } from "@playwright/test";

/** Read the painted colors across the middle of the control. */
export async function controlPixels(control: Locator) {
  const screenshot = await control.screenshot({ scale: "css" });
  return control.evaluate(async (_, png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot read control screenshot");
    context.drawImage(image, 0, 0);
    const color = (x: number, y: number) => {
      const [r, g, b] = context.getImageData(x, y, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };
    return {
      background: color(image.width / 2, 2),
      row: Array.from({ length: image.width }, (_, x) =>
        color(x, image.height / 2),
      ),
    };
  }, screenshot.toString("base64"));
}
