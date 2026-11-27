import { parseArgs } from "node:util";
import { integer } from "../inProcess/optionValues";

export interface PlanOptions {
  /** Path to a saved `perf:statements` or `perf:canaries --statements` JSONL capture. */
  readonly capture: string;
  /** Maximum number of top normalized SELECT queries to EXPLAIN. */
  readonly limit: number;
  /** Disable sequential scans to test whether an index can serve each query. */
  readonly disableSeqScan: boolean;
}

export const planUsage = `Run PostgreSQL EXPLAIN (GENERIC_PLAN) over the top SELECT queries in a statement capture.

DATABASE_URL=postgres://$USER@localhost:5432/<scratch> \\
  bun run perf:plans --capture .test_files/performance/<capture>.jsonl \\
    [--limit 20] [--disable-seqscan]

Migrates the local scratch PostgreSQL database named by DATABASE_URL, reads
the top normalized SELECT queries from --capture, and runs EXPLAIN
(GENERIC_PLAN, FORMAT JSON) on each. Flags Seq Scan, Sort, and Materialize
nodes and saves JSON and Markdown reports under .test_files/performance/.`;

export function parsePlanOptions(args: readonly string[]): PlanOptions | null {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      capture: { type: "string" },
      limit: { type: "string" },
      "disable-seqscan": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help) return null;
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument ${positionals[0]}; see --help.`);
  }
  if (!values.capture) {
    throw new Error("--capture must name a statement capture JSONL file.");
  }
  return {
    capture: values.capture,
    limit:
      values.limit === undefined
        ? 20
        : integer(values.limit, "--limit", 1, 200),
    disableSeqScan: values["disable-seqscan"],
  };
}
