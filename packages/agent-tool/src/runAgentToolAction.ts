import { openPr } from "./pr/openPr";
import { squashMerge } from "./pr/squashMerge";
import { solicitClaudeCodeReview } from "./review/solicitClaudeCodeReview";
import { solicitCodexReview } from "./review/solicitCodexReview";
import { solicitOpencodeReview } from "./review/solicitOpencodeReview";
import { bumpVersions, checkVersions } from "./version/bumpVersions";
import { prepareVersions } from "./version/prepareVersions";
import { resolveVersionConflicts } from "./version/resolveVersionConflicts";

const AGENT_TOOL_USAGE =
  "Usage: agent-tool <solicitClaudeCodeReview|solicitCodexReview|solicitOpencodeReview|openPr|squashMerge|prepareVersions|bumpVersions|checkVersions|resolveVersionConflicts> [args]\n";

export interface AgentToolActions {
  readonly prepareVersions: (rootDir: string, baseOid?: string) => number;
  readonly bumpVersions: (rootDir: string, baseOid?: string) => number;
  readonly checkVersions: (rootDir: string, baseOid?: string) => number;
  readonly resolveVersionConflicts: (rootDir: string) => number;
  readonly openPr: (rootDir: string, title?: string) => number;
  readonly solicitClaudeCodeReview: (
    rootDir: string,
    effort?: string,
  ) => number;
  readonly solicitCodexReview: (rootDir: string, effort?: string) => number;
  readonly solicitOpencodeReview: (rootDir: string, effort?: string) => number;
  readonly squashMerge: (
    rootDir: string,
    subject?: string,
    expectedHeadSha?: string,
    expectedBaseRef?: string,
  ) => number;
}

const defaultActions: AgentToolActions = {
  prepareVersions,
  bumpVersions,
  checkVersions,
  resolveVersionConflicts,
  openPr,
  solicitClaudeCodeReview,
  solicitCodexReview,
  solicitOpencodeReview,
  squashMerge,
};

function assertMaximumPositionals(
  action: string,
  positionals: readonly string[],
  maximum: number,
): void {
  if (positionals.length > maximum) {
    throw new Error(
      `${action} accepts at most ${maximum} positional argument${maximum === 1 ? "" : "s"}.`,
    );
  }
}

/** Dispatch one public agent-tool action with its positional CLI arguments. */
export function runAgentToolAction(
  rootDir: string,
  args: readonly string[],
  actions: AgentToolActions = defaultActions,
): number {
  const [action, ...positionals] = args;
  const [first, second, third] = positionals;
  switch (action) {
    case "prepareVersions": {
      assertMaximumPositionals(action, positionals, 1);
      return actions.prepareVersions(rootDir, first);
    }
    case "bumpVersions": {
      assertMaximumPositionals(action, positionals, 1);
      return actions.bumpVersions(rootDir, first);
    }
    case "checkVersions": {
      assertMaximumPositionals(action, positionals, 1);
      return actions.checkVersions(rootDir, first);
    }
    case "resolveVersionConflicts": {
      assertMaximumPositionals(action, positionals, 0);
      return actions.resolveVersionConflicts(rootDir);
    }
    case "solicitClaudeCodeReview": {
      assertMaximumPositionals(action, positionals, 1);
      return actions.solicitClaudeCodeReview(rootDir, first);
    }
    case "solicitCodexReview": {
      assertMaximumPositionals(action, positionals, 1);
      return actions.solicitCodexReview(rootDir, first);
    }
    case "solicitOpencodeReview": {
      assertMaximumPositionals(action, positionals, 1);
      return actions.solicitOpencodeReview(rootDir, first);
    }
    case "openPr": {
      assertMaximumPositionals(action, positionals, 1);
      return actions.openPr(rootDir, first);
    }
    case "squashMerge": {
      assertMaximumPositionals(action, positionals, 3);
      return actions.squashMerge(rootDir, first, second, third);
    }
    default:
      process.stderr.write(`Unknown action: ${action ?? "(none)"}\n`);
      process.stderr.write(AGENT_TOOL_USAGE);
      return 1;
  }
}
