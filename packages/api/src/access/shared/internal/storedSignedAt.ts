/**
 * `signedAt` is inside every signature, and the column holds a `Date`, so a row
 * must print the exact submitted string or every reader (this server included)
 * rebuilds a different header and nothing can supersede the head. The shared
 * readers bound the range a `timestamp` column keeps verbatim; this is the
 * in-transaction proof that the store agreed, so a drifted row never commits.
 */
export function assertStoredSignedAtVerbatim(
  served: string,
  submitted: string,
  reject: (message: string) => never,
): void {
  if (served !== submitted) {
    reject(`signedAt ${submitted} would be served back as ${served}`);
  }
}
