// Ready-made wallpapers: quiet tessellations of the plane, each one tile of
// SVG repeated edge to edge. A host lists the ones it offers, alongside its
// own, in its WallpaperProvider. Shapes that cross a tile's edge are drawn in
// full from every neighboring cell, so the clipped halves meet seamlessly.

import type { WallpaperDefinition, WallpaperTile } from "./wallpapers";

type Point = readonly [x: number, y: number];

const SQRT3 = Math.sqrt(3);

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function tile(width: number, height: number, body: string): WallpaperTile {
  const w = round(width);
  const h = round(height);
  return {
    height: Number(h),
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
    width: Number(w),
  };
}

function polygon(points: ReadonlyArray<Point>, opacity = 1): string {
  const list = points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
  const fill = opacity === 1 ? "" : ` fill-opacity="${opacity}"`;
  return `<polygon points="${list}"${fill}/>`;
}

// The whole tile at one shade, beneath the shapes drawn over it.
function ground(width: number, height: number, opacity: number): string {
  return `<rect width="${round(width)}" height="${round(height)}" fill-opacity="${opacity}"/>`;
}

type Hexagon = readonly [Point, Point, Point, Point, Point, Point];

// A pointy-topped hexagon's corners, clockwise from the top.
function hexagon([cx, cy]: Point, radius: number): Hexagon {
  const half = (radius * SQRT3) / 2;
  return [
    [cx, cy - radius],
    [cx + half, cy - radius / 2],
    [cx + half, cy + radius / 2],
    [cx, cy + radius],
    [cx - half, cy + radius / 2],
    [cx - half, cy - radius / 2],
  ];
}

// Hexagon centers covering one w-by-3r cell of a pointy-topped hex grid,
// including every neighbor whose outline reaches into the cell.
function hexCenters(width: number, radius: number): Point[] {
  const rows: ReadonlyArray<readonly [y: number, xs: number[]]> = [
    [0, [0, width]],
    [1.5 * radius, [-width / 2, width / 2, 1.5 * width]],
    [3 * radius, [0, width]],
  ];
  return rows.flatMap(([y, xs]) => xs.map((x): Point => [x, y]));
}

/** Cubes seen corner-on, each in three shades: the tumbling-blocks quilt. */
export const BLOCKS_WALLPAPER: WallpaperDefinition<"blocks"> = (() => {
  const radius = 18;
  const width = radius * SQRT3;
  const centers: Point[] = [
    [width / 2, radius],
    [0, 2.5 * radius],
    [width, 2.5 * radius],
    [0, -0.5 * radius],
    [width, -0.5 * radius],
  ];
  // The ground is the darkest face's shade, so faces never meet over a gap
  // of bare base where their antialiased edges would show as seams.
  const faces = centers
    .map((center) => {
      const [top, upperRight, , bottom, lowerLeft, upperLeft] = hexagon(
        center,
        radius,
      );
      return [
        polygon([top, upperRight, center, upperLeft], 1),
        polygon([upperLeft, center, bottom, lowerLeft], 0.55),
      ].join("");
    })
    .join("");
  const height = 3 * radius;
  return {
    id: "blocks",
    label: "Blocks",
    tile: tile(width, height, `${ground(width, height, 0.2)}${faces}`),
  };
})();

/** Outlined hexagons, as a honeycomb. */
export const HONEYCOMB_WALLPAPER: WallpaperDefinition<"honeycomb"> = (() => {
  const radius = 16;
  const width = radius * SQRT3;
  const body = hexCenters(width, radius)
    .map((center) => polygon(hexagon(center, radius)))
    .join("");
  return {
    id: "honeycomb",
    label: "Honeycomb",
    tile: tile(
      width,
      3 * radius,
      `<g fill="none" stroke="#000" stroke-width="1.5">${body}</g>`,
    ),
  };
})();

/** Equilateral triangles, alternately dark and light. */
export const TRIANGLES_WALLPAPER: WallpaperDefinition<"triangles"> = (() => {
  const side = 36;
  const height = (side * SQRT3) / 2;
  const half = side / 2;
  // Inverted triangles are the lighter ground between the upright ones.
  const upright = [
    // The first row's upright triangle.
    polygon([
      [0, height],
      [side, height],
      [half, 0],
    ]),
    // The second row's, offset by half a side.
    polygon([
      [0, height],
      [-half, 2 * height],
      [half, 2 * height],
    ]),
    polygon([
      [side, height],
      [half, 2 * height],
      [side + half, 2 * height],
    ]),
  ].join("");
  return {
    id: "triangles",
    label: "Triangles",
    tile: tile(side, 2 * height, `${ground(side, 2 * height, 0.4)}${upright}`),
  };
})();

/** Diamonds on a lighter ground, as a harlequin's coat. */
export const HARLEQUIN_WALLPAPER: WallpaperDefinition<"harlequin"> = {
  id: "harlequin",
  label: "Harlequin",
  tile: tile(
    32,
    48,
    `${ground(32, 48, 0.35)}${polygon([
      [16, 0],
      [32, 24],
      [16, 48],
      [0, 24],
    ])}`,
  ),
};

/** Zigzag bands. */
export const CHEVRON_WALLPAPER: WallpaperDefinition<"chevron"> = {
  id: "chevron",
  label: "Chevron",
  tile: tile(
    40,
    20,
    polygon([
      [0, 0],
      [20, 10],
      [40, 0],
      [40, 10],
      [20, 20],
      [0, 10],
    ]),
  ),
};

/** No pattern: the theme's desk color alone. */
export const PLAIN_WALLPAPER: WallpaperDefinition<"plain"> = {
  id: "plain",
  label: "None",
};
