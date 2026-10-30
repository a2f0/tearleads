/**
 * A line-oriented Markdown reader for documentation checks. It is not a full
 * CommonMark parser: it finds fenced code, code spans, links, and headings
 * well enough to validate the repository's own documents, and errs toward
 * reporting nothing inside code.
 */

export interface MarkdownLine {
  /** One-based line number. */
  readonly number: number;
  readonly text: string;
  /** `text` with every code span's content blanked to spaces, same length. */
  readonly masked: string;
  /** Code spans on this line, by column in `text`. */
  readonly codeSpans: readonly CodeSpan[];
}

export interface CodeSpan {
  /** Index of the opening backtick run. */
  readonly start: number;
  /** Index just past the closing backtick run. */
  readonly end: number;
  readonly content: string;
}

export interface MarkdownTarget {
  readonly line: number;
  /** One-based column of the target. */
  readonly column: number;
  readonly target: string;
}

const fencePattern = /^ {0,3}(`{3,}|~{3,})/;

/** Lines outside fenced code blocks, with code spans located and masked. */
export function proseLines(source: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let fence: string | null = null;
  for (const [index, text] of source.split("\n").entries()) {
    const marker = fencePattern.exec(text)?.[1];
    if (fence !== null) {
      if (
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        text.trim() === marker
      ) {
        fence = null;
      }
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    const codeSpans = findCodeSpans(text);
    let masked = text;
    for (const span of codeSpans) {
      masked =
        masked.slice(0, span.start) +
        " ".repeat(span.end - span.start) +
        masked.slice(span.end);
    }
    lines.push({ number: index + 1, text, masked, codeSpans });
  }
  return lines;
}

function findCodeSpans(text: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    let runEnd = index;
    while (text[runEnd] === "`") runEnd += 1;
    const run = text.slice(index, runEnd);
    let close = text.indexOf(run, runEnd);
    // A longer backtick run does not close a shorter one.
    while (close !== -1 && text[close + run.length] === "`") {
      let skip = close;
      while (text[skip] === "`") skip += 1;
      close = text.indexOf(run, skip);
    }
    if (close === -1) {
      index = runEnd;
      continue;
    }
    spans.push({
      start: index,
      end: close + run.length,
      content: text.slice(runEnd, close).trim(),
    });
    index = close + run.length;
  }
  return spans;
}

/**
 * The bracketed text ranges of inline and reference links (`[text](target)`,
 * `[text][label]`, `[text][]`) on a masked line, as [open, close] indexes of
 * the brackets.
 */
export function linkTextRanges(masked: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of masked.matchAll(/\][([]/g)) {
    const close = match.index;
    let depth = 0;
    for (let open = close - 1; open >= 0; open -= 1) {
      if (masked[open] === "]") depth += 1;
      if (masked[open] === "[") {
        if (depth === 0) {
          ranges.push([open, close]);
          break;
        }
        depth -= 1;
      }
    }
  }
  return ranges;
}

const inlineTargetPattern =
  /\]\(\s*(<[^>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const definitionPattern = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/;
const htmlTargetPattern = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const autolinkPattern = /<((?:https?|mailto):[^\s<>]+)>/g;
const bareUrlPattern = /(?<![(<"'=/\w])https?:\/\/[^\s<>()[\]`"']+/g;

/** Every link, image, definition, and HTML href/src target outside code. */
export function markdownTargets(source: string): MarkdownTarget[] {
  const targets: MarkdownTarget[] = [];
  for (const line of proseLines(source)) {
    const add = (target: string, index: number) => {
      const trimmed = target.replace(/^<|>$/g, "");
      if (trimmed !== "") {
        targets.push({ line: line.number, column: index + 1, target: trimmed });
      }
    };
    for (const match of line.masked.matchAll(inlineTargetPattern)) {
      add(match[1] ?? "", match.index + 2);
    }
    const definition = definitionPattern.exec(line.masked);
    if (definition?.[1] !== undefined) {
      add(definition[1], line.masked.indexOf(definition[1]));
    }
    for (const match of line.masked.matchAll(htmlTargetPattern)) {
      add(match[1] ?? match[2] ?? "", match.index);
    }
    for (const match of line.masked.matchAll(autolinkPattern)) {
      add(match[1] ?? "", match.index + 1);
    }
    for (const match of line.masked.matchAll(bareUrlPattern)) {
      add(match[0].replace(/[.,;:!?*_]+$/, ""), match.index);
    }
  }
  return dedupeTargets(targets);
}

// A bare URL inside an inline link's target is found twice; keep one.
function dedupeTargets(targets: MarkdownTarget[]): MarkdownTarget[] {
  const seen = new Set<string>();
  return targets.filter(({ line, target }) => {
    const key = `${line}\0${target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The fragment ids GitHub generates for a document's headings (github-slugger
 * rules, with -1, -2 suffixes for repeats), plus explicit HTML ids and names.
 */
export function headingAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  // github-slugger: a repeat takes the next free -n suffix, skipping slugs
  // that earlier headings produced literally (`A`, `A-1`, `A` -> a-2).
  const occurrences = new Map<string, number>();
  const slugs = new Set<string>();
  const addSlug = (text: string) => {
    const base = slugify(text);
    let slug = base;
    while (slugs.has(slug)) {
      const count = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, count);
      slug = `${base}-${count}`;
    }
    slugs.add(slug);
    anchors.add(slug);
  };
  const lines = proseLines(source);
  for (const [index, line] of lines.entries()) {
    const atx = /^ {0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line.text);
    if (atx !== null) {
      addSlug(atx[1] ?? "");
    } else {
      const next = lines[index + 1];
      if (
        next !== undefined &&
        next.number === line.number + 1 &&
        /^ {0,3}(=+|-+)\s*$/.test(next.text) &&
        isSetextContent(line.text)
      ) {
        addSlug(line.text);
      }
    }
    for (const match of line.masked.matchAll(
      /<[a-z][^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/gi,
    )) {
      if (match[1] !== undefined) anchors.add(match[1]);
    }
  }
  return anchors;
}

function isSetextContent(text: string): boolean {
  return (
    text.trim() !== "" &&
    !/^ {0,3}([-*+>|]|\d+[.)]|#)/.test(text) &&
    !/^\s{4}/.test(text)
  );
}

/** github-slugger applied to a heading's rendered text. */
export function slugify(heading: string): string {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`/g, "")
    .replace(/(\*+|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}]))/gu, "")
    .trim();
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}
