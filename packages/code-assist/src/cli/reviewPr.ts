import { loadConfig } from "../config";
import { createGithubClient, resolveGithubToken } from "../github/githubClient";
import { postReview } from "../github/postReview";
import { createLlmClient } from "../llm/deepseekClient";
import { buildReviewSummary } from "../review/reviewSummary";
import { runReview } from "../review/runReview";

interface CliArgs {
  readonly pullNumber: number;
  readonly owner: string;
  readonly repo: string;
  readonly post: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const positional: string[] = [];
  let owner = "a2f0";
  let repo = "symcrypt";
  let post = false;

  for (const arg of argv) {
    if (arg === "--post") {
      post = true;
    } else if (arg.startsWith("--repo=")) {
      const value = arg.slice("--repo=".length);
      const [parsedOwner, parsedRepo] = value.split("/");
      if (!parsedOwner || !parsedRepo) {
        throw new Error(`Invalid --repo value: ${value} (expected owner/repo)`);
      }
      owner = parsedOwner;
      repo = parsedRepo;
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  const first = positional[0];
  if (!first) {
    throw new Error(
      "Usage: bun run review <pr-number> [--post] [--repo=owner/repo]",
    );
  }
  const pullNumber = Number.parseInt(first, 10);
  if (Number.isNaN(pullNumber)) {
    throw new Error(`Invalid PR number: ${first}`);
  }
  return { pullNumber, owner, repo, post };
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const config = loadConfig();
  const token = await resolveGithubToken();
  const octokit = createGithubClient(token);
  const llm = createLlmClient(config.deepseekApiKey, config.baseUrl);

  console.log(
    `Reviewing PR #${args.pullNumber} from ${args.owner}/${args.repo} with ${config.model}...`,
  );
  const result = await runReview({
    octokit,
    llm,
    owner: args.owner,
    repo: args.repo,
    pullNumber: args.pullNumber,
    model: config.model,
    existingMarkerIds: new Set<string>(),
    ignorePatterns: config.ignorePatterns,
    severityThreshold: config.severityThreshold,
    maxComments: config.maxComments,
    styleguide: null,
  });
  if (result.skipped) {
    console.log("No reviewable diff (binary-only or empty PR).");
    return;
  }

  console.log(
    `\n${result.comments.length} comment(s) to post; ${result.dropped.length} dropped (out-of-diff anchor).`,
  );
  for (const comment of result.comments) {
    console.log(`\n--- ${comment.path}:${comment.line}`);
    console.log(comment.body);
  }

  if (!args.post) {
    console.log("\n(dry run — pass --post to publish the review)");
    return;
  }

  await postReview({
    octokit,
    owner: args.owner,
    repo: args.repo,
    pullNumber: args.pullNumber,
    commitId: result.headSha,
    comments: result.comments,
    summary: buildReviewSummary(result.comments.length),
  });
  console.log("\nReview posted.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
