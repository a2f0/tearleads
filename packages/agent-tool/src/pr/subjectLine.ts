/**
 * Resolve a single-line commit-style subject: trim the supplied value, fall
 * back to `fallback` when it is empty, and reject an empty result or any
 * embedded line break so the value stays a single header line (commitlint would
 * otherwise accept later lines as a body and let them through). `noun` labels
 * the value in error messages.
 */
export function singleLineSubject(
  value: string | undefined,
  fallback: string,
  noun: string,
): string {
  const subject = (value ?? "").trim() || fallback;
  if (subject.length === 0) {
    throw new Error(`No ${noun} provided and no fallback is available.`);
  }
  if (/[\r\n]/.test(subject)) {
    throw new Error(`${noun} must be a single line (no line breaks).`);
  }
  return subject;
}
