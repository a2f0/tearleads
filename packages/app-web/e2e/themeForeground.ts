import type { Locator } from "@playwright/test";

export async function themeForeground(control: Locator) {
  return control.evaluate((element) => {
    const swatch = document.createElement("span");
    swatch.style.color = "var(--color-dark)";
    element.after(swatch);
    const color = getComputedStyle(swatch).color;
    swatch.remove();
    return color;
  });
}
