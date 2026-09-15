import { expect, test } from "bun:test";
import {
  ProjectionError,
  parseRecordedTrace,
  renderTraceModule,
  traceModuleName,
  traceStepFormula,
} from "./restartProbeTraceModule";

test("renders parameterized actions and observation conjunctions", () => {
  expect(
    traceStepFormula({ action: "RemoteBodyAdvance", delivered: true }, 0),
  ).toBe("RemoteBodyAdvance(TRUE)");
  expect(
    traceStepFormula(
      { action: "FinishProbe", observed: { probeRequested: false } },
      1,
    ),
  ).toBe("FinishProbe /\\ probeRequested' = FALSE");
});

test("rejects unknown actions and missing parameters", () => {
  expect(() => traceStepFormula({ action: "TeleportProbe" }, 0)).toThrow(
    ProjectionError,
  );
  expect(() => traceStepFormula({ action: "RemoteSlotAdvance" }, 2)).toThrow(
    'missing "delivered"',
  );
});

test("renders a complete bounded trace module", () => {
  const trace = {
    model: "RestartProbeConvergence",
    scenario: "sample-trace",
    steps: [
      { action: "DisconnectEvents" },
      { action: "RemoteBodyAdvance", delivered: false },
    ],
  };
  expect(traceModuleName(trace, "Negative")).toBe("TraceSampleTraceNegative");
  const rendered = renderTraceModule("TraceSampleTrace", trace);
  expect(rendered.module).toContain("---- MODULE TraceSampleTrace ----");
  expect(rendered.module).toContain("TraceLen == 2");
  expect(rendered.module).toContain("CASE step = 1 -> DisconnectEvents");
  expect(rendered.module).toContain("[] step = 2 -> RemoteBodyAdvance(FALSE)");
  expect(rendered.module).toContain("[] OTHER -> FALSE");
  // The trace-derived bounds must admit every advance and disconnect.
  expect(rendered.cfg).toContain("MaxVersion = 1");
  expect(rendered.cfg).toContain("MaxDisconnects = 1");
  expect(() =>
    renderTraceModule("TraceEmpty", { ...trace, steps: [] }),
  ).toThrow("records no steps");
});

test("parses recorded traces fail-closed", () => {
  const valid = JSON.stringify({
    model: "RestartProbeConvergence",
    scenario: "sample",
    steps: [{ action: "Restart" }],
  });
  expect(parseRecordedTrace("sample.json", valid).steps).toHaveLength(1);
  expect(() =>
    parseRecordedTrace(
      "wrong-model.json",
      JSON.stringify({ model: "Other", scenario: "s", steps: [] }),
    ),
  ).toThrow("malformed");
  // Observation keys are an allow-list: a typo must not reach TLA generation.
  expect(() =>
    parseRecordedTrace(
      "bad-observation.json",
      JSON.stringify({
        model: "RestartProbeConvergence",
        scenario: "s",
        steps: [{ action: "Restart", observed: { probeRequsted: true } }],
      }),
    ),
  ).toThrow("malformed");
});
