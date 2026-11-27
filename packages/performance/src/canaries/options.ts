import { parseArgs } from "node:util";
import { integer } from "../realtime/optionValues";

export type CanaryOptions =
  | {
      readonly mode: "run";
      /** Name filters; empty runs every canary. */
      readonly canaries: readonly string[];
      readonly samples: number;
      /** A previous report to compare this run with. */
      readonly baseline: string | null;
      /** Capture the API's statements beside the request profile. */
      readonly statements: boolean;
      /** Hash each statement's bind values, to tell keys apart. */
      readonly paramHash: boolean;
      /** Record sanitized per-pane field bytes, echoes, redeliveries, and head re-reads. */
      readonly payloadAudit: boolean;
      /** Capture filtered issuer call stacks beside `--payload-audit`. */
      readonly stacks: boolean;
    }
  | {
      readonly mode: "compare";
      readonly before: string;
      readonly after: string;
    };

export const canaryUsage = `Run the app's request-volume canaries and record their request profiles.

bun run perf:canaries [--canary <name>]... [--samples 1..5] [--baseline <report.json>]
                      [--statements [--param-hash]] [--payload-audit [--stacks]]
bun run perf:canaries --compare <before.json> <after.json>

Finds every packages/app test that profiles its proxied API requests, runs
each file on its own with DUAL_PANE_REQUEST_PROFILE=1 and
DUAL_PANE_REQUEST_PROFILE_DETAIL=1, and saves per-phase request counts, body
bytes and per-endpoint tables under .test_files/performance/, as JSON and as
Markdown. --canary keeps the canaries whose name contains the text. Repeat
each file with --samples, for byte claims. --baseline compares this run with
an earlier report; --compare only compares two saved reports. Relative
report paths resolve from the repository root. --statements also records
every statement the in-process API sends, counts them per phase, and keeps
each file's capture for bun run perf:statements --summarize; --param-hash
adds a hash of each statement's bind values. --payload-audit records per-pane
field byte totals, echoes, redeliveries, uploaded-then-redownloaded bytes,
manifest citations, and exact-head re-reads without storing raw bodies or
tokens; --stacks adds filtered issuer stacks.`;

export function parseCanaryOptions(args: string[]): CanaryOptions | null {
  const { values, positionals } = parseArgs({
    args,
    options: {
      canary: { type: "string", multiple: true, default: [] },
      samples: { type: "string" },
      baseline: { type: "string" },
      compare: { type: "boolean", default: false },
      statements: { type: "boolean", default: false },
      "param-hash": { type: "boolean", default: false },
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
    if (!before || !after || rest.length > 0)
      throw new Error("--compare takes exactly two report paths.");
    if (
      values.canary.length > 0 ||
      values.samples !== undefined ||
      values.baseline !== undefined ||
      values.statements ||
      values["param-hash"] ||
      values["payload-audit"] ||
      values.stacks
    )
      throw new Error("--compare reads saved reports; it runs no canaries.");
    return { mode: "compare", before, after };
  }
  if (positionals.length > 0)
    throw new Error(`Unexpected argument ${positionals[0]}; see --help.`);
  if (values["param-hash"] && !values.statements)
    throw new Error("--param-hash needs --statements.");
  if (values.stacks && !values["payload-audit"])
    throw new Error("--stacks needs --payload-audit.");
  return {
    mode: "run",
    canaries: values.canary,
    samples:
      values.samples === undefined
        ? 1
        : integer(values.samples, "--samples", 1, 5),
    baseline: values.baseline ?? null,
    statements: values.statements,
    paramHash: values["param-hash"],
    payloadAudit: values["payload-audit"],
    stacks: values.stacks,
  };
}
