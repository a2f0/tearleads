import { expect, test } from "bun:test";
import {
  ProjectionError,
  parseRecordedTrace,
  projectionFormula,
  type RecordedNoBrickTrace,
  renderTraceModule,
  traceBounds,
  traceModuleName,
  traceStepFormula,
} from "./noBrickTraceModule";

const PROJECTION = {
  head: 3,
  honestPrefix: 2,
  cited: 1,
  late: true,
  authority: 2,
} as const;

const TRACE: RecordedNoBrickTrace = {
  model: "NoBrickedDevice",
  scenario: "sample-trace",
  initialCheckpoints: { d1: 1 },
  steps: [
    { action: "CommitDependent", late: true },
    { action: "RevokeLateSigner" },
    { action: "HonestSync", device: "d1", observed: { outcome: "accepted" } },
    {
      action: "Verify",
      device: "d1",
      projection: PROJECTION,
      observed: { outcome: "refused" },
    },
  ],
};

test("renders actions, projections, and outcome conjunctions", () => {
  expect(traceStepFormula({ action: "CommitDependent", late: false })).toBe(
    "CommitDependent(FALSE)",
  );
  expect(traceStepFormula({ action: "SyncAuthority", device: "d2" })).toBe(
    'SyncAuthority("d2")',
  );
  expect(
    traceStepFormula({
      action: "HonestSync",
      device: "d1",
      observed: { outcome: "refused" },
    }),
  ).toBe('HonestSync("d1") /\\ outcome\'["d1"] = "refused"');
  expect(projectionFormula(PROJECTION)).toBe(
    "[head |-> 3, honestPrefix |-> 2, cited |-> 1, late |-> TRUE, authority |-> 2]",
  );
  const verify = traceStepFormula({
    action: "Verify",
    device: "d1",
    projection: PROJECTION,
    observed: { outcome: "accepted" },
  });
  expect(verify).toContain("WellFormed([head |-> 3");
  expect(verify).toContain('Verify("d1", [head |-> 3');
  expect(verify).toContain("UNCHANGED honestRefused");
  expect(verify).toContain('outcome\'["d1"] = "accepted"');
});

test("derives bounds from every version a trace advances to or names", () => {
  expect(traceBounds(TRACE)).toEqual({
    maxAuthorityVersion: 2,
    maxDependentVersion: 3,
  });
  expect(
    traceBounds({
      ...TRACE,
      steps: [{ action: "AdvanceAuthority" }, { action: "AdvanceAuthority" }],
    }),
  ).toEqual({ maxAuthorityVersion: 3, maxDependentVersion: 1 });
});

test("renders a complete bounded trace module pinned to the initial checkpoints", () => {
  expect(traceModuleName(TRACE, "Negative")).toBe("TraceSampleTraceNegative");
  const rendered = renderTraceModule("TraceSampleTrace", TRACE);
  expect(rendered.module).toContain("---- MODULE TraceSampleTrace ----");
  expect(rendered.module).toContain("EXTENDS NoBrickedDevice, Naturals");
  expect(rendered.module).toContain("TraceLen == 4");
  expect(rendered.module).toContain("CASE step = 1 -> CommitDependent(TRUE)");
  expect(rendered.module).toContain("[] step = 2 -> RevokeLateSigner");
  expect(rendered.module).toContain("[] OTHER -> FALSE");
  expect(rendered.module).toContain(
    'checkpoint = [d \\in Devices |-> IF d = "d1" THEN 1 ELSE 0]',
  );
  expect(rendered.cfg).toContain('Devices = {"d1"}');
  expect(rendered.cfg).toContain("MaxAuthorityVersion = 2");
  expect(rendered.cfg).toContain("MaxDependentVersion = 3");
  expect(rendered.cfg).toContain("ServerHonest = FALSE");
  expect(rendered.cfg).toContain("RefuseStaleHeadCitation = FALSE");
  expect(rendered.cfg).toContain("INVARIANT HonestServerNeverRefused");
  expect(() =>
    renderTraceModule("TraceEmpty", { ...TRACE, steps: [] }),
  ).toThrow("records no steps");
});

test("parses recorded traces fail-closed", () => {
  expect(
    parseRecordedTrace("sample.json", JSON.stringify(TRACE)).steps,
  ).toHaveLength(4);
  const malformed = [
    { ...TRACE, model: "Other" },
    { ...TRACE, initialCheckpoints: {} },
    { ...TRACE, initialCheckpoints: { "D-1": 1 } },
    { ...TRACE, initialCheckpoints: { d1: 2 } },
    { ...TRACE, steps: [{ action: "TeleportHead" }] },
    { ...TRACE, steps: [{ action: "CommitDependent" }] },
    { ...TRACE, steps: [{ action: "SyncAuthority", device: "d9" }] },
    {
      ...TRACE,
      steps: [
        {
          action: "HonestSync",
          device: "d1",
          observed: { outcom: "accepted" },
        },
      ],
    },
    {
      ...TRACE,
      steps: [
        {
          action: "Verify",
          device: "d1",
          projection: { ...PROJECTION, head: 0 },
          observed: { outcome: "refused" },
        },
      ],
    },
    {
      ...TRACE,
      steps: [
        {
          action: "Verify",
          device: "d1",
          projection: { ...PROJECTION, extra: 1 },
          observed: { outcome: "refused" },
        },
      ],
    },
  ];
  for (const trace of malformed) {
    expect(() => parseRecordedTrace("bad.json", JSON.stringify(trace))).toThrow(
      ProjectionError,
    );
  }
});
