import { expect, test } from "bun:test";
import { createTracer } from "./trace";

const message = (line: string) => line.replace(/^\S+ \+ *[\d.]+s {2}/u, "");

function fakeTracer(enabled = true) {
  const lines: string[] = [];
  let ms = 0;
  const tracer = createTracer({
    clock: () => new Date(Date.UTC(2026, 10, 4, 12, 0, 0, ms)),
    enabled,
    now: () => ms,
    write: (line) => lines.push(line),
  });
  return {
    advance: (by: number) => {
      ms += by;
    },
    lines,
    tracer,
  };
}

test("each line carries the wall-clock time and the seconds since start", () => {
  const { advance, lines, tracer } = fakeTracer();
  advance(1234);
  tracer.event("hello");

  expect(lines).toEqual(["2026-11-04T12:00:01.234Z +   1.234s  hello"]);
});

test("spans report their duration, including failures", async () => {
  const { advance, lines, tracer } = fakeTracer();

  expect(
    await tracer.span("sign in", async () => {
      advance(42);
      return "ok";
    }),
  ).toBe("ok");
  await expect(
    tracer.span("list folders", async () => {
      advance(1500);
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");

  expect(lines.map(message)).toEqual([
    "sign in ...",
    "sign in done in 42ms",
    "list folders ...",
    "list folders failed after 1.50s",
  ]);
  lines.length = 0;
  tracer.summary();
  expect(lines.map(message).slice(1, 3)).toEqual([
    "  phase sign in: 42ms",
    "  phase list folders (failed): 1.50s",
  ]);
});

test("the summary lists phases and the slowest endpoints first", async () => {
  const { advance, lines, tracer } = fakeTracer();
  await tracer.span("sign in", async () => advance(10));
  tracer.recordRequest("GET /a", 5);
  tracer.recordRequest("POST /b", 30);
  tracer.recordRequest("GET /a", 15);
  lines.length = 0;
  tracer.summary();

  expect(lines.map(message)).toEqual([
    "summary: total 10ms",
    "  phase sign in: 10ms",
    "  3 API request(s) across 2 endpoint(s)",
    "  POST /b: 1x, 30ms total, 30ms avg",
    "  GET /a: 2x, 20ms total, 10ms avg",
  ]);
});

test("traced text is escaped like other output", () => {
  const { lines, tracer } = fakeTracer();
  tracer.event("name \u001b[2J");

  expect(lines[0]).toEndWith("name \\u{001b}[2J");
});

test("a disabled tracer writes nothing and still runs spans", async () => {
  const { lines, tracer } = fakeTracer(false);
  tracer.event("hidden");
  expect(await tracer.span("work", async () => 7)).toBe(7);
  tracer.summary();

  expect(lines).toEqual([]);
});
