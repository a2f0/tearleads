import type { Octokit } from "@octokit/rest";
import type OpenAI from "openai";
import { buildAnchorMap } from "../github/diffAnchors";
import { fetchPullRequest } from "../github/fetchPullRequest";
import {
  mapFindingsToComments,
  type ReviewComment,
} from "../github/mapFindingsToComments";
import type { Severity } from "../severity";
import { renderDiff } from "./renderDiff";
import { generateReview } from "./reviewer";
import type { ReviewFinding } from "./reviewSchema";

interface RunReviewParams {
  readonly octokit: Octokit;
  readonly llm: OpenAI;
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly model: string;
  readonly severityThreshold: Severity;
  readonly maxComments: number;
  readonly styleguide: string | null;
}

interface ReviewResult {
  readonly skipped: boolean;
  readonly title: string;
  readonly headSha: string;
  readonly comments: readonly ReviewComment[];
  readonly dropped: readonly ReviewFinding[];
  readonly findingCount: number;
}

/**
 * The full review pipeline shared by the CLI and the webhook handler: fetch the
 * PR diff, ask the model for findings, then map them to postable inline comments.
 * Does not post — the caller decides whether to publish.
 */
export async function runReview(
  params: RunReviewParams,
): Promise<ReviewResult> {
  const pull = await fetchPullRequest(
    params.octokit,
    params.owner,
    params.repo,
    params.pullNumber,
  );
  const diff = renderDiff(pull.files);
  if (!diff) {
    return {
      skipped: true,
      title: pull.title,
      headSha: pull.headSha,
      comments: [],
      dropped: [],
      findingCount: 0,
    };
  }

  const findings = await generateReview({
    client: params.llm,
    model: params.model,
    diff,
    styleguide: params.styleguide,
  });
  const { comments, dropped } = mapFindingsToComments(findings, {
    anchors: buildAnchorMap(pull.files),
    severityThreshold: params.severityThreshold,
    maxComments: params.maxComments,
  });
  return {
    skipped: false,
    title: pull.title,
    headSha: pull.headSha,
    comments,
    dropped,
    findingCount: findings.length,
  };
}
