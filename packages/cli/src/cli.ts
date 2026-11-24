import { parseArgs } from "node:util";
import type { CliContext, CommandInput } from "./cliContext";
import { login, logout, whoami } from "./commands/account";
import { listFolders, listOrganizations } from "./commands/browse";
import { printable } from "./printable";
import { isTargetName } from "./targets";
import { createTracer } from "./trace";

export const usage = `Usage: tearleads <command> [--env production|staging|development] [--org <id>] [--trace]

Commands:
  login    Save a recovery key (seed phrase) for the target in the Keychain.
           Reads it from the terminal without echo, or from piped stdin.
  logout   Remove the target's saved recovery key.
  whoami   Show the signed-in user, signing fingerprint, and organization.
  orgs     List the organizations you belong to.
  seed     Sync the Continuity screenshot dataset to your personal organization.
  verify-seed  Check the original fixture contents and bytes from a fresh session.
  ls       List the folders of your organization, or of --org <id>.

--env defaults to production; development is the local API at
http://localhost:3001. Every command signs in, works on an in-memory
database, and revokes its session before exiting.

--key-stdin reads a one-time recovery key for seed or verify-seed.

--trace (or TEARLEADS_TRACE=1) prints timestamped progress to stderr: each
step, API request, and sync lane run with its duration, then a summary of
where the time went.`;

const commands = {
  login,
  logout,
  ls: listFolders,
  orgs: listOrganizations,
  seed: async (input) => (await import("./commands/seed")).seed(input),
  "verify-seed": async (input) =>
    (await import("./commands/verifySeed")).verifySeed(input),
  whoami,
} satisfies Record<string, (input: CommandInput) => Promise<void>>;

function isCommandName(value: string): value is keyof typeof commands {
  return Object.hasOwn(commands, value);
}

function parse(argv: readonly string[]) {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      env: { type: "string", default: "production" },
      help: { type: "boolean", short: "h", default: false },
      org: { type: "string" },
      "key-stdin": { type: "boolean", default: false },
      trace: { type: "boolean", default: false },
    },
    strict: true,
  });
  return { positionals, values };
}

/** Runs one command and returns the process exit code. */
export async function runCli(
  argv: readonly string[],
  context: CliContext,
): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    context.stderr(error instanceof Error ? error.message : String(error));
    context.stderr(usage);
    return 2;
  }

  const { positionals, values } = parsed;
  const [commandName, ...extra] = positionals;
  if (values.help || commandName === undefined || commandName === "help") {
    context.stdout(usage);
    return 0;
  }
  if (!isCommandName(commandName) || extra.length > 0) {
    context.stderr(`Unknown command: ${positionals.join(" ")}`);
    context.stderr(usage);
    return 2;
  }
  if (!isTargetName(values.env)) {
    context.stderr(
      `Unknown --env ${values.env}; use production, staging, or development.`,
    );
    return 2;
  }

  if (
    values["key-stdin"] &&
    commandName !== "seed" &&
    commandName !== "verify-seed"
  ) {
    context.stderr("--key-stdin applies to seed and verify-seed.");
    return 2;
  }
  const tracer = createTracer({
    enabled: values.trace || context.traceByDefault === true,
    write: (line) => context.stderr(line),
  });
  try {
    await commands[commandName]({
      context,
      keyFromStdin: values["key-stdin"],
      organizationId: values.org,
      target: values.env,
      tracer,
    });
    return 0;
  } catch (error) {
    context.stderr(
      printable(error instanceof Error ? error.message : String(error)),
    );
    return 1;
  } finally {
    tracer.summary();
  }
}
