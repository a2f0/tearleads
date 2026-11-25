import { parseArgs } from "node:util";
import type { CliContext, CommandInput } from "./cliContext";
import { login, logout, register, whoami } from "./commands/account";
import { listFolders, listOrganizations } from "./commands/browse";
import { printable } from "./printable";
import { isTargetName } from "./targets";
import { createTracer } from "./trace";

export const usage = `Usage: tearleads <command> [--env production|staging|development] [--org <id>] [--trace]
       tearleads register|seed|verify-seed --key-stdin [--api-url <origin>]
       tearleads register|seed --roster [--accept-terms]

Commands:
  login    Save a recovery key (seed phrase) for the target in the Keychain.
           Reads it from the terminal without echo, or from piped stdin.
  register Create the account for a recovery key, as a new app install does,
           then save the key like login. An existing account is left as is.
  logout   Remove the target's saved recovery key.
  whoami   Show the signed-in user, signing fingerprint, and organization.
  orgs     List the organizations you belong to.
  seed     Sync the Continuity screenshot dataset to your personal organization.
  verify-seed  Check the original fixture contents and bytes from a fresh session.
  ls       List the folders of your organization, or of --org <id>.

--env defaults to production; development is the local API at
http://localhost:3001. Every command signs in, works on an in-memory
database, and revokes its session before exiting.

--key-stdin reads a one-time recovery key for register, seed, or verify-seed,
and keeps it out of the Keychain.

Creating an account means agreeing to the Tearleads Privacy Policy and Terms of
Service. register, and seed --roster for each member account it creates, print
both documents' addresses and ask you to type yes. --accept-terms agrees
without asking, as it must when no terminal can ask (for example with
--key-stdin).

--api-url <origin> uses that API instead of an --env target, such as a local
test API. It needs --key-stdin, so no target's saved key is sent to it, and
plain http only for a loopback host.

seed --roster also gives each member of the dataset's groups (today a Family
group) an account derived from yours, adds them to your organization's roster,
and then to the group. Each member takes a seat on a billed organization.

--trace (or TEARLEADS_TRACE=1) prints timestamped progress to stderr: each
step, API request, and sync lane run with its duration, then a summary of
where the time went.`;

const commands = {
  login,
  logout,
  ls: listFolders,
  orgs: listOrganizations,
  register,
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
      "accept-terms": { type: "boolean", default: false },
      "api-url": { type: "string" },
      env: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      org: { type: "string" },
      "key-stdin": { type: "boolean", default: false },
      roster: { type: "boolean", default: false },
      trace: { type: "boolean", default: false },
    },
    strict: true,
  });
  return { positionals, values };
}

const KEY_STDIN_COMMANDS: ReadonlySet<string> = new Set([
  "register",
  "seed",
  "verify-seed",
]);

// Plain http would send the session token unencrypted anywhere else.
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "[::1]",
  "localhost",
]);

/** The usage error a flag given to a command it does not apply to makes. */
function misappliedFlag(
  commandName: string,
  values: ReturnType<typeof parse>["values"],
): string | null {
  if (values.roster && commandName !== "seed") {
    return "--roster applies to seed.";
  }
  // Only these create accounts, which is what the terms govern.
  const createsAccounts =
    commandName === "register" || (commandName === "seed" && values.roster);
  if (values["accept-terms"] && !createsAccounts) {
    return "--accept-terms applies to register and seed --roster.";
  }
  if (values["key-stdin"] && !KEY_STDIN_COMMANDS.has(commandName)) {
    return "--key-stdin applies to register, seed, and verify-seed.";
  }
  return null;
}

/** The command's API, or the usage error that stops it before any request. */
function commandOptions(
  commandName: string,
  values: ReturnType<typeof parse>["values"],
): Pick<CommandInput, "apiUrl" | "target"> | string {
  const target = values.env ?? "production";
  if (!isTargetName(target)) {
    return `Unknown --env ${target}; use production, staging, or development.`;
  }
  const misapplied = misappliedFlag(commandName, values);
  if (misapplied !== null) return misapplied;
  const apiUrl = values["api-url"];
  if (apiUrl === undefined) return { target };
  if (values.env !== undefined) return "Use either --env or --api-url.";
  if (!values["key-stdin"]) return "--api-url needs --key-stdin.";
  const parsed = URL.canParse(apiUrl) ? new URL(apiUrl) : null;
  if (
    !parsed ||
    !(
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname))
    ) ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    return `--api-url ${apiUrl} is not an https origin, or an http origin on a loopback host such as http://127.0.0.1:3001.`;
  }
  return { apiUrl: parsed.origin, target };
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
  const options = commandOptions(commandName, values);
  if (typeof options === "string") {
    context.stderr(options);
    return 2;
  }
  const tracer = createTracer({
    enabled: values.trace || context.traceByDefault === true,
    write: (line) => context.stderr(line),
  });
  try {
    await commands[commandName]({
      context,
      ...options,
      acceptTerms: values["accept-terms"],
      keyFromStdin: values["key-stdin"],
      organizationId: values.org,
      roster: values.roster,
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
