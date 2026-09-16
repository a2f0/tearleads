/**
 * The owner's Home tagline, verbatim. It drives the Home title, the hero h1,
 * and the closing band.
 */
export const tagline = "Zero knowledge. Zero onboarding.";

/**
 * One sentence per line. Render the lines with a space between them so the
 * heading's accessible name stays the full tagline.
 */
export const taglineLines: readonly string[] = tagline.split(/(?<=\.)\s+/);
