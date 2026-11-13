import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";

import { LaserScreensaver } from "./LaserScreensaver";

import { startLaserAnimation } from "./laserAnimation";

let canvas: HTMLCanvasElement;
let strokes: string[];
let points: { x: number; y: number }[];
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let stop: (() => void) | undefined;
let media: MediaQueryList;

beforeEach(() => {
  canvas = document.createElement("canvas");
  strokes = [];
  points = [];
  frames = new Map();
  nextFrame = 0;
  const context = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    fillRect: mock(),
    setTransform: mock(),
    beginPath: mock(),
    moveTo: mock(),
    lineTo(x: number, y: number) {
      points.push({ x, y });
    },
    stroke() {
      strokes.push(this.strokeStyle);
    },
  };
  spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  spyOn(window, "matchMedia").mockReturnValue(media);
});

afterEach(() => {
  cleanup();
  stop?.();
  stop = undefined;
  mock.restore();
});

test("the plugin mounts its canvas and releases the real animation", () => {
  const view = render(createElement(LaserScreensaver));
  expect(
    view.container.querySelector("canvas.laser-screensaver"),
  ).not.toBeNull();
  expect(frames.size).toBe(1);
  view.unmount();
  expect(frames.size).toBe(0);
});

test("bounces within the viewport and caps the trails", () => {
  spyOn(Math, "random").mockReturnValue(0.999);
  spyOn(performance, "now").mockReturnValue(0);
  stop = startLaserAnimation(canvas);
  for (let index = 1; index <= 140; index += 1) {
    const callback = [...frames.values()][0];
    if (!callback) throw new Error("Missing next animation frame");
    frames.clear();
    strokes = [];
    points = [];
    callback(index * (1000 / 60));
  }
  expect(strokes.length).toBe(6 * 99);
  expect(
    points.every(
      ({ x, y }) =>
        x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight,
    ),
  ).toBe(true);
});

test("resizes the canvas but stops listening after cleanup", () => {
  const original = window.innerWidth;
  stop = startLaserAnimation(canvas);
  try {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 720,
    });
    window.dispatchEvent(new Event("resize"));
    expect(canvas.width).toBe(
      Math.round(720 * Math.min(window.devicePixelRatio || 1, 2)),
    );
    stop();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });
    window.dispatchEvent(new Event("resize"));
    expect(canvas.width).toBe(
      Math.round(720 * Math.min(window.devicePixelRatio || 1, 2)),
    );
    expect(frames.size).toBe(0);
  } finally {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: original,
    });
  }
});

test("a missing canvas context leaves no animation or listeners", () => {
  spyOn(canvas, "getContext").mockReturnValue(null);
  stop = startLaserAnimation(canvas);
  expect(frames.size).toBe(0);
  window.dispatchEvent(new Event("resize"));
  expect(strokes).toEqual([]);
});

test("draws six grayscale lasers and stops its animation on cleanup", () => {
  stop = startLaserAnimation(canvas);
  expect(canvas.width).toBeGreaterThan(0);
  expect(canvas.height).toBeGreaterThan(0);
  expect(new Set(strokes).size).toBe(6);
  for (const color of strokes) {
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(color.slice(1, 3)).toBe(color.slice(3, 5));
    expect(color.slice(3, 5)).toBe(color.slice(5, 7));
  }
  expect(frames.size).toBe(1);
  stop();
  expect(frames.size).toBe(0);
});

test("reduced motion draws static trails and reacts to preference changes", () => {
  Object.defineProperty(media, "matches", { configurable: true, value: true });
  stop = startLaserAnimation(canvas);
  expect(strokes.length).toBeGreaterThan(6);
  expect(frames.size).toBe(0);

  Object.defineProperty(media, "matches", { configurable: true, value: false });
  media.dispatchEvent(new Event("change"));
  expect(frames.size).toBe(1);

  Object.defineProperty(media, "matches", { configurable: true, value: true });
  media.dispatchEvent(new Event("change"));
  expect(frames.size).toBe(0);

  stop();
  Object.defineProperty(media, "matches", { configurable: true, value: false });
  media.dispatchEvent(new Event("change"));
  expect(frames.size).toBe(0);
});
