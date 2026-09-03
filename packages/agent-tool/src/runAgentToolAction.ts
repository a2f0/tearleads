import { openPr } from "./pr/openPr";
import { squashMerge } from "./pr/squashMerge";
import { solicitClaudeCodeReview } from "./review/solicitClaudeCodeReview";
import { solicitCodexReview } from "./review/solicitCodexReview";

const AGENT_TOOL_USAGE =
  "Usage: agent-tool <solicitClaudeCodeReview|solicitCodexReview|openPr|squashMerge> [args]\n";

export interface AgentToolActions {
  readonly openPr: (rootDir: string, title?: string) => number;
  readonly solicitClaudeCodeReview: (
    rootDir: string,
    effort?: string,
  ) => number;
  readonly solicitCodexReview: (rootDir: string, effort?: string) => number;
  readonly squashMerge: (
    rootDir: string,
    subject?: string,
    expectedHeadSha?: string,
    expectedBaseRef?: string,
  ) => number;
}

const defaultActions: AgentToolActions = {
  openPr,
  solicitClaudeCodeReview,
  solicitCodexReview,
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
    case "solicitClaudeCodeReview": {
      assertMaximumPositionals(action, positionals, 1);
      return actions.solicitClaudeCodeReview(rootDir, first);
    }
    case "solicitCodexReview": {
      assertMaximumPositionals(action, positionals, 1);
      return actions.solicitCodexReview(rootDir, first);
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
