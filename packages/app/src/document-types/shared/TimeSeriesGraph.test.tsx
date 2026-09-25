import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { TimeSeriesGraph } from "./TimeSeriesGraph";
import {
  type TimeSeriesPoint,
  trackerGraphTimestamp,
} from "./timeSeriesGraphData";

afterEach(cleanup);

function graph(points: TimeSeriesPoint[]) {
  return (
    <TimeSeriesGraph
      title="Measurements over time"
      unit="kg"
      series={[{ id: "weight", label: "Weight", points }]}
    />
  );
}

test("plots chronological time gaps and numeric values without reordering input", () => {
  const points = [
    { id: "last", measuredAt: "2026-07-20T08:00", value: 80 },
    { id: "first", measuredAt: "2026-07-16T08:00", value: 82 },
    { id: "middle", measuredAt: "2026-07-17T08:00", value: 81 },
  ];
  const view = render(graph(points));
  const circles = Array.from(view.getByRole("img").querySelectorAll("circle"));
  expect(circles.map((point) => point.textContent)).toEqual([
    "Weight: 82 kg · 2026-07-16 08:00",
    "Weight: 81 kg · 2026-07-17 08:00",
    "Weight: 80 kg · 2026-07-20 08:00",
  ]);
  const [first = 0, middle = 0, last = 0] = circles.map((point) =>
    Number(point.getAttribute("cx")),
  );
  expect((middle - first) / (last - first)).toBeCloseTo(0.25);
  expect(Number(circles[0]?.getAttribute("cy"))).toBeLessThan(
    Number(circles[2]?.getAttribute("cy")),
  );
  expect(points.map((point) => point.id)).toEqual(["last", "first", "middle"]);
  expect(view.getByRole("img").getAttribute("aria-describedby")).toBeTruthy();
});

test("omits missing, invalid and impossible dates and non-finite values", () => {
  const view = render(
    graph([
      { id: "empty", measuredAt: "", value: 80 },
      { id: "invalid", measuredAt: "not a date", value: 80 },
      { id: "rollover", measuredAt: "2026-02-30T08:00", value: 80 },
      { id: "nan", measuredAt: "2026-07-16T08:00", value: Number.NaN },
      {
        id: "infinite",
        measuredAt: "2026-07-16T08:00",
        value: Number.POSITIVE_INFINITY,
      },
    ]),
  );
  expect(view.queryByRole("img")).toBeNull();
  expect(
    view.getByText("Add a dated measurement to see the graph."),
  ).toBeTruthy();
});

test("keeps a single point and equal-time, constant readings visible", () => {
  const first = { id: "first", measuredAt: "2026-07-16T08:00", value: 80 };
  const view = render(graph([first]));
  const original = view.container.querySelector("circle");
  expect(Number(original?.getAttribute("cx"))).toBeGreaterThan(52);
  expect(Number(original?.getAttribute("cy"))).toBeGreaterThan(16);
  expect(Number(original?.getAttribute("cy"))).toBeLessThan(192);
  view.rerender(graph([first, { ...first, id: "second" }]));
  const circles = view.container.querySelectorAll("circle");
  expect(circles).toHaveLength(2);
  expect(circles[0]?.getAttribute("cx")).toBe(circles[1]?.getAttribute("cx"));
  expect(circles[0]?.getAttribute("cy")).toBe(circles[1]?.getAttribute("cy"));
  expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/u);
  view.rerender(graph([]));
  expect(view.queryByRole("img")).toBeNull();
});

test("reads local measurement time independently of timezone, including seconds", () => {
  expect(trackerGraphTimestamp("2026-03-08T02:30")).toBe(
    Date.UTC(2026, 2, 8, 2, 30),
  );
  expect(trackerGraphTimestamp("2026-07-16T08:30:45.25")).toBe(
    Date.UTC(2026, 6, 16, 8, 30, 45, 250),
  );
  expect(trackerGraphTimestamp("2026-07-16T24:30")).toBeNaN();
});

test("close decimal weights have distinct vertical-axis labels", () => {
  const view = render(
    graph([
      { id: "first", measuredAt: "2026-07-16T08:00", value: 180.25 },
      { id: "second", measuredAt: "2026-07-17T08:00", value: 180.26 },
    ]),
  );
  const labels = Array.from(
    view.container.querySelectorAll('text[dominant-baseline="middle"]'),
  ).map((label) => label.textContent);
  expect(labels.length).toBeGreaterThan(1);
  expect(new Set(labels).size).toBe(labels.length);
});
