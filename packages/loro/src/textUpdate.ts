import type { LoroDoc } from "loro-crdt";

/**
 * The longest a text write may spend in each of Loro's diffs, in
 * milliseconds. Both run in one synchronous WebAssembly call and take time
 * quadratic in how much of the text differs, so an unbounded one stalls the
 * writer: replacing a 64 KB note with unrelated text took 8 s in the
 * character diff, and 20,000 short lines that all differ took 6 s in the line
 * diff.
 */
export const TEXT_DIFF_BUDGET_MS = 100;

/**
 * How finely a text write was expressed, which decides how it merges with
 * concurrent edits:
 *
 * - `character`: only the characters that differ were deleted and inserted.
 * - `line`: only the lines that differ were. A concurrent edit inside a
 *   rewritten line loses its surroundings.
 * - `whole`: every character held was deleted and the new text inserted, so
 *   a concurrent insert survives with none of the text it was written into.
 */
export type TextUpdateGranularity = "character" | "line" | "whole";

export interface TextUpdateOptions {
  /** Budget for the character diff. Defaults to `TEXT_DIFF_BUDGET_MS`. */
  readonly characterBudgetMs?: number;
  /** The text container to write. Defaults to `text`. */
  readonly key?: string;
  /** Budget for the line diff. Defaults to `TEXT_DIFF_BUDGET_MS`. */
  readonly lineBudgetMs?: number;
}

// Loro throws this, as an `Error`, when a diff passes its `timeoutMs`.
const DIFF_TIMEOUT_MESSAGE = "Update timeout";

/**
 * Whether `diff` finished inside its budget. A diff that runs out throws
 * before it changes the document, so the next strategy starts from the same
 * text. Any other failure is thrown.
 */
function finishesInBudget(diff: () => void): boolean {
  try {
    diff();
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === DIFF_TIMEOUT_MESSAGE) {
      return false;
    }
    throw error;
  }
}

/**
 * Set a document's text to `value` in bounded time: by the character diff
 * when it finishes inside its budget, else by the line diff, else by
 * replacing the whole text. The caller commits.
 */
export function updateText(
  doc: LoroDoc,
  value: string,
  options: TextUpdateOptions = {},
): TextUpdateGranularity {
  const text = doc.getText(options.key ?? "text");
  const characterBudgetMs = options.characterBudgetMs ?? TEXT_DIFF_BUDGET_MS;
  if (
    finishesInBudget(() => text.update(value, { timeoutMs: characterBudgetMs }))
  ) {
    return "character";
  }
  const lineBudgetMs = options.lineBudgetMs ?? TEXT_DIFF_BUDGET_MS;
  if (
    finishesInBudget(() =>
      text.updateByLine(value, { timeoutMs: lineBudgetMs }),
    )
  ) {
    return "line";
  }
  text.delete(0, text.length);
  text.insert(0, value);
  return "whole";
}
