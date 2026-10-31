import type { WallpaperDefinition } from "@tearleads/windowing";

// These are alpha artwork, not colored pictures: the host's theme supplies the
// ground and pigment. Keep both colors on the wallpaper element so scoped
// themes and the Display Properties swatches resolve the same palette.
function palette(accent: string) {
  return {
    base: `color-mix(in srgb, var(--tearleads-background, var(--color-light)) 94%, ${accent})`,
    ink: `color-mix(in srgb, var(--color-dark) 48%, ${accent})`,
  };
}

function svg(width: number, height: number, artwork: string) {
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${artwork}</svg>`,
  };
}

// A complete period has two opposed currents. The Bezier tangents match at
// each 256px boundary; the second row is half a period out of phase. Draw the
// neighbouring periods too, rather than clipping off the thick ribbon ends.
function current(y: number) {
  return `M-256 ${y} ${[-256, 0, 256]
    .map(
      (x) =>
        `C${x + 42} ${y - 54} ${x + 86} ${y - 54} ${x + 128} ${y} C${x + 170} ${y + 54} ${x + 214} ${y + 54} ${x + 256} ${y}`,
    )
    .join(" ")}`;
}

const tidal = [0, 128, 256]
  .map(
    (
      y,
      row,
    ) => `<g transform="translate(${row % 2 === 0 ? 0 : 128} ${y})" fill="none" stroke="black">
      <path d="${current(0)}" stroke-width="46" stroke-opacity=".18"/>
      <path d="${current(0)}" stroke-width="24" stroke-opacity=".12"/>
      ${[-14, -6, 6, 14]
        .map(
          (offset) =>
            `<path d="${current(offset)}" stroke-width=".8" stroke-opacity=".22"/>`,
        )
        .join("")}
    </g>`,
  )
  .join("");

// Off-centre folds split a broad diamond into five unequal planes. The motif
// tessellates on (240, 0)/(120, 80); neighbouring diamonds carry every face
// across the crop, so the tile edge is never an artificial crease.
const fold = `<path d="M0 0 120-80 108 10Z" fill-opacity=".13"/>
  <path d="M120-80 240 0 108 10Z" fill-opacity=".29"/>
  <path d="M240 0 158 36 108 10Z" fill-opacity=".38"/>
  <path d="M240 0 120 80 158 36Z" fill-opacity=".22"/>
  <path d="M120 80 0 0 108 10 158 36Z" fill-opacity=".06"/>
  <path d="M0 0 108 10 240 0M108 10 158 36 120 80" fill="none" stroke="black" stroke-opacity=".14" stroke-width=".7"/>`;
const facet = [-80, 0, 80, 160, 240]
  .map((y, row) =>
    [-240, 0, 240]
      .map(
        (x) =>
          `<g transform="translate(${x + (row % 2 === 0 ? 120 : 0)} ${y})">${fold}</g>`,
      )
      .join(""),
  )
  .join("");

// Weave in orthogonal loom coordinates, then turn the whole cloth diagonally.
// At alternate crossings each band stops short of its partner, leaving a
// narrow shadow gap. All pieces of a direction share one path, so touching
// translucent segments don't leave doubled-alpha seams at cell boundaries.
function strand(x: number, y: number, horizontal: boolean, over: boolean) {
  const bands: string[] = [];
  const threads: string[] = [];
  const spans = over
    ? [[-65, 65]]
    : [
        [-65, -32],
        [32, 65],
      ];
  const point = (along: number, across: number) =>
    horizontal ? `${x + along} ${y + across}` : `${x + across} ${y + along}`;
  for (const [start = 0, end = 0] of spans) {
    bands.push(
      `M${point(start, -28)}L${point(end, -28)}L${point(end, 28)}L${point(start, 28)}Z`,
    );
    for (const thread of [-20, -14, 14, 20]) {
      threads.push(`M${point(start, thread)}L${point(end, thread)}`);
    }
  }
  return { bands, threads };
}

function wovenBands() {
  const warp: string[] = [];
  const weft: string[] = [];
  const threads: string[] = [];
  for (let row = -2; row <= 2; row++) {
    for (let column = 0; column <= 4; column++) {
      for (const horizontal of [true, false]) {
        const part = strand(
          column * 128,
          row * 128,
          horizontal,
          horizontal === ((row + column) % 2 === 0),
        );
        (horizontal ? warp : weft).push(...part.bands);
        threads.push(...part.threads);
      }
    }
  }
  return `<g transform="matrix(.5 .5 -.5 .5 0 0)">
    <path d="${warp.join(" ")}" fill-opacity=".27"/>
    <path d="${weft.join(" ")}" fill-opacity=".14"/>
    <path d="${threads.join(" ")}" fill="none" stroke="black" stroke-opacity=".12" stroke-width=".7"/>
  </g>`;
}

export const TIDAL_WALLPAPER: WallpaperDefinition<"tidal"> = {
  id: "tidal",
  label: "Tidal",
  ...palette("#287882"),
  tile: svg(256, 256, tidal),
};

export const FACET_WALLPAPER: WallpaperDefinition<"facet"> = {
  id: "facet",
  label: "Facet",
  ...palette("#75658d"),
  tile: svg(
    240,
    160,
    `<rect width="240" height="160" fill-opacity=".035"/>${facet}`,
  ),
};

export const LOOM_WALLPAPER: WallpaperDefinition<"loom"> = {
  id: "loom",
  label: "Loom",
  ...palette("#927452"),
  tile: svg(256, 256, wovenBands()),
};
