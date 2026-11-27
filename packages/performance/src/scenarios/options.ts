import { parseArgs } from "node:util";
import { integer } from "../inProcess/optionValues";

export type ScenarioOptions =
  | {
      readonly mode: "run";
      /** Name filters; empty runs every bob-and-alice scenario. */
      readonly scenarios: readonly string[];
      readonly samples: number;
      /** A previous report to compare this run with. */
      readonly baseline: string | null;
      /** Capture the API's ORM statements beside the HTTP profile. */
      readonly statements: boolean;
      /** Hash each statement's bind values to split pure read repeats. */
      readonly paramHash: boolean;
      /** Record local client SQLite statements and mutation-lock holds. */
      readonly clientStatements: boolean;
      /** Record sanitized per-device field bytes, echoes, redeliveries, and head re-reads. */
      readonly payloadAudit: boolean;
      /** Capture filtered issuer call stacks beside `--payload-audit`. */
      readonly stacks: boolean;
    }
  | {
      readonly mode: "compare";
      readonly before: string;
      readonly after: string;
    };

export const scenarioUsage = `Profile packages/bob-and-alice end-to-end multi-party scenarios.

bun run perf:scenarios [--scenario <name>]... [--samples 1..5] [--baseline <report.json>]
                       [--statements [--param-hash]] [--client-statements]
                       [--payload-audit [--stacks]]
bun run perf:scenarios --compare <before.json> <after.json>

Discovers every scenario under packages/bob-and-alice/src/scenarios, runs each
file on its own with HTTP and harness operation capture on (API_DATABASE=memory
unless set), and saves per-scenario request counts, 409 conflicts, wire bytes,
route breakdowns, and optional API SQL, client SQLite, and payload-audit
summaries under .test_files/performance/ as JSON and Markdown. --scenario keeps
scenarios whose name contains the text, ignoring case. --baseline compares this
run with an earlier report; --compare only compares two saved reports.`;

export function parseScenarioOptions(args: string[]): ScenarioOptions | null {
  const { values, positionals } = parseArgs({
    args,
    options: {
      scenario: { type: "string", multiple: true, default: [] },
      samples: { type: "string" },
      baseline: { type: "string" },
      compare: { type: "boolean", default: false },
      statements: { type: "boolean", default: false },
      "param-hash": { type: "boolean", default: false },
      "client-statements": { type: "boolean", default: false },
      "payload-audit": { type: "boolean", default: false },
      stacks: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help) return null;
  if (values.compare) {
    const [before, after, ...rest] = positionals;
    if (!before || !after || rest.length > 0) {
      throw new Error("--compare takes exactly two report paths.");
    }
    if (
      values.scenario.length > 0 ||
      values.samples !== undefined ||
      values.baseline !== undefined ||
      values.statements ||
      values["param-hash"] ||
      values["client-statements"] ||
      values["payload-audit"] ||
      values.stacks
    ) {
      throw new Error("--compare reads saved reports; it runs no scenarios.");
    }
    return { mode: "compare", before, after };
  }
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument ${positionals[0]}; see --help.`);
  }
  if (values["param-hash"] && !values.statements) {
    throw new Error("--param-hash needs --statements.");
  }
  if (values.stacks && !values["payload-audit"]) {
    throw new Error("--stacks needs --payload-audit.");
  }
  return {
    mode: "run",
    scenarios: values.scenario,
    samples:
      values.samples === undefined
        ? 1
        : integer(values.samples, "--samples", 1, 5),
    baseline: values.baseline ?? null,
    statements: values.statements,
    paramHash: values["param-hash"],
    clientStatements: values["client-statements"],
    payloadAudit: values["payload-audit"],
    stacks: values.stacks,
  };
}
