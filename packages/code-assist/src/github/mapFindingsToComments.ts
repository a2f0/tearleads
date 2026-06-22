import type { ReviewFinding } from "../review/reviewSchema";
import {
  compareSeverityDesc,
  meetsThreshold,
  type Severity,
  severityLabel,
} from "../severity";
import type { FileAnchors } from "./diffAnchors";
import { findingMarkerId, renderMarker } from "./findingMarker";

export interface ReviewComment {
  readonly path: string;
  readonly line: number;
  readonly side: "RIGHT";
  readonly body: string;
}

interface MappedFindings {
  readonly comments: readonly ReviewComment[];
  readonly dropped: readonly ReviewFinding[];
}

interface MapOptions {
  readonly anchors: Map<string, FileAnchors>;
  readonly existingMarkerIds: ReadonlySet<string>;
  readonly severityThreshold: Severity;
  readonly maxComments: number;
}

function isAnchored(anchors: FileAnchors | undefined, line: number): boolean {
  if (!anchors) {
    return false;
  }
  return anchors.added.has(line) || anchors.context.has(line);
}

// Model output is attacker-influenced (a PR diff feeds the prompt). Strip any
// embedded code-assist marker comments so relayed text cannot forge a dedup
// marker (extractMarkerIds parses these on later runs and assumes only the bot
// emits them; a forged id can silently suppress a future real finding).
function stripMarkers(text: string): string {
  return text.replace(/<!--\s*code-assist:[^>]*-->/gi, "");
}

// A GitHub ```suggestion block must contain the exact replacement code, so we
// cannot safely escape a stray fence inside it (mangling would corrupt the
// applied suggestion). If the model output contains a ``` run it could break
// out of the fence, so we drop the suggestion entirely and keep the prose.
function renderSuggestion(suggestion: string | null | undefined): string {
  if (!suggestion || /`{3,}/.test(suggestion)) {
    return "";
  }
  return `\n\n\`\`\`suggestion\n${stripMarkers(suggestion)}\n\`\`\``;
}

function renderBody(finding: ReviewFinding, markerId: string): string {
  const header = `${severityLabel(finding.severity)} — ${finding.title}`;
  const suggestion = renderSuggestion(finding.suggestion);
  return `${header}\n\n${stripMarkers(finding.body)}${suggestion}\n\n${renderMarker(markerId)}`;
}

export function mapFindingsToComments(
  findings: readonly ReviewFinding[],
  options: MapOptions,
): MappedFindings {
  const ordered = [...findings].sort((a, b) =>
    compareSeverityDesc(a.severity, b.severity),
  );
  const comments: ReviewComment[] = [];
  const dropped: ReviewFinding[] = [];

  for (const finding of ordered) {
    if (!meetsThreshold(finding.severity, options.severityThreshold)) {
      continue;
    }
    const markerId = findingMarkerId(finding.path, finding.title);
    if (options.existingMarkerIds.has(markerId)) {
      continue;
    }
    if (!isAnchored(options.anchors.get(finding.path), finding.line)) {
      dropped.push(finding);
      continue;
    }
    comments.push({
      path: finding.path,
      line: finding.line,
      side: "RIGHT",
      body: renderBody(finding, markerId),
    });
    if (comments.length >= options.maxComments) {
      break;
    }
  }
  return { comments, dropped };
}
