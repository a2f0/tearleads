import { parseArgs } from "node:util";
import { integer } from "../inProcess/optionValues";

export type StatementOptions =
  | {
      readonly mode: "run";
      /** A directory under `packages`, such as `api` or `app`. */
      readonly package: string;
      /** Test files, relative to the package. */
      readonly files: readonly string[];
      /** Bun's `-t` test name pattern. */
      readonly name: string | null;
      readonly paramHash: boolean;
      readonly limit: number | null;
    }
  | { readonly mode: "summarize"; readonly capture: string };

export const statementUsage = `Record every statement the API's ORM sends while tests run, and summarize them.

bun run perf:statements --package api --file <test file>... [--name <pattern>]
                        [--param-hash] [--limit <records>]
bun run perf:statements --summarize <capture.jsonl>

Runs bun test in packages/<package> on the given files, relative to that
package, with its own preloads and then the statement capture preload. API
tests use API_DATABASE=memory unless it is set. --name is bun test's -t
pattern. --param-hash adds a hash of each statement's bind values, so a
repeated statement can be told apart from one reading another key; bind
values are never written. --limit stops recording after that many records.
The capture, its summary as JSON and Markdown, and the test output are saved
under .test_files/performance/. --summarize summarizes an existing capture,
such as one perf:canaries --statements kept; relative paths resolve from the
repository root.`;

export function parseStatementOptions(args: string[]): StatementOptions | null {
  const { values, positionals } = parseArgs({
    args,
    options: {
      package: { type: "string" },
      file: { type: "string", multiple: true, default: [] },
      name: { type: "string" },
      "param-hash": { type: "boolean", default: false },
      limit: { type: "string" },
      summarize: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help) return null;
  if (positionals.length > 0)
    throw new Error(`Unexpected argument ${positionals[0]}; use --file.`);
  if (values.summarize !== undefined) {
    if (
      values.package !== undefined ||
      values.file.length > 0 ||
      values.name !== undefined ||
      values["param-hash"] ||
      values.limit !== undefined
    )
      throw new Error("--summarize reads a saved capture; it runs no tests.");
    return { mode: "summarize", capture: values.summarize };
  }
  if (!values.package || !/^[a-z][a-z0-9-]*$/u.test(values.package))
    throw new Error("--package must name a directory under packages.");
  if (values.file.length === 0) throw new Error("Name at least one --file.");
  return {
    mode: "run",
    package: values.package,
    files: values.file,
    name: values.name ?? null,
    paramHash: values["param-hash"],
    limit:
      values.limit === undefined
        ? null
        : integer(values.limit, "--limit", 1, 100_000_000),
  };
}
