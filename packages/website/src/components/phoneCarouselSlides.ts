import {
  findScreenshot,
  type ScreenshotEntry,
  type ScreenshotManifest,
} from "./screenshotsManifest";

export interface PhoneCarouselScreen {
  /** Manifest screen id. */
  readonly name: string;
  readonly caption: string;
  readonly alt: string;
}

export interface PhoneCarouselSlide extends PhoneCarouselScreen {
  readonly light: ScreenshotEntry;
  readonly dark: ScreenshotEntry | undefined;
}

/**
 * The screens that have a light phone capture, in order, each with its dark
 * capture when there is one. A row needs at least two phones to scroll, so
 * fewer yields none (CI and test builds stage an empty manifest).
 */
export function phoneCarouselSlides(
  manifest: ScreenshotManifest,
  screens: readonly PhoneCarouselScreen[],
): PhoneCarouselSlide[] {
  const slides = screens.flatMap((screen) => {
    const light = findScreenshot(manifest, "mobile", "light", screen.name);
    if (!light) return [];
    const dark = findScreenshot(manifest, "mobile", "dark", screen.name);
    return [{ ...screen, light, dark }];
  });
  return slides.length >= 2 ? slides : [];
}
