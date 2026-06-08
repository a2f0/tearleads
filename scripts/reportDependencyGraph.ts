import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cruise, type OutputType } from "dependency-cruiser";

import {
  createDependencyCruiserOptions,
  dependencyCruiserEntryPoints,
} from "./dependencyCruiserConfig";

const supportedFormats = new Set<OutputType>([
  "archi",
  "err",
  "json",
  "mermaid",
]);

interface CliOptions {
  format: OutputType;
  outputPath?: string;
}

function usage(): string {
  return [
    "Usage: bun scripts/reportDependencyGraph.ts [--format err|json|mermaid|archi] [--output path]",
    "",
    "Formats:",
    "  err      CI-oriented rule violation output",
    "  json     full dependency-cruiser diagnostics",
    "  mermaid  Mermaid dependency graph",
    "  archi    Graphviz DOT output for a collapsed architecture graph",
  ].join("\n");
}

function nextArg(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = { format: "err" };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    if (arg === "--format" || arg === "--output-type") {
      const format = nextArg(args, index, arg) as OutputType;

      if (!supportedFormats.has(format)) {
        throw new Error(`Unsupported format "${format}"`);
      }

      options.format = format;
      index += 1;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      options.outputPath = nextArg(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${arg}"`);
  }

  return options;
}

async function writeOutput(outputPath: string, content: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const result = await cruise(
    dependencyCruiserEntryPoints,
    createDependencyCruiserOptions(options.format),
  );
  const output =
    typeof result.output === "string"
      ? result.output
      : JSON.stringify(result.output, null, 2);

  if (options.outputPath) {
    await writeOutput(options.outputPath, output);
  } else if (output.trim().length > 0) {
    console.log(output);
  }

  process.exitCode = result.exitCode;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
}
