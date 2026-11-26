import {
  createReadOnlyDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportUpdatesInVersionRange,
  importUpdates,
  isLoroRuntimeFailure,
  meetVersionVectors,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";

type HistoryDocument = ReturnType<typeof createReadOnlyDocument>;

/** How this device's history compares with the one rebuilt from signed updates. */
export interface DocumentHistoryComparison {
  /**
   * Every operation id both histories hold names the same operation, with
   * the same commit time, in both.
   */
  readonly matches: boolean;
  /** The signed history holds operations this device's does not. */
  readonly serverAhead: boolean;
}

/**
 * The identity of `signed` cut at `meet`, or null when that cut is not a
 * version of it: some operation inside depends on one outside. A copy holding
 * exactly the cut's operations proves it whole, where an export bounded by
 * version would drop such an operation without saying so.
 */
function identityOfCut(signed: HistoryDocument, meet: string): string | null {
  const cut = exportUpdatesInVersionRange(signed, emptyVersionVector(), meet);
  if (cut === null) return null;
  const prefix = createReadOnlyDocument();
  try {
    importUpdates(prefix, [cut]);
    return versionVectorsEqual(encodeVersionVector(prefix), meet)
      ? exportFullHistoryIdentity(prefix)
      : null;
  } catch (error) {
    if (isLoroRuntimeFailure(error)) throw error;
    return null;
  } finally {
    prefix.free();
  }
}

/**
 * Compares two histories on the operations both hold: the meet of their
 * versions. Each may hold more, as this device does with an unsent edit and
 * the server does with an update the device has not pulled; those operations
 * are outside the comparison.
 *
 * The identity replays a history into an empty document, which leaves out an
 * operation whose dependency is missing. So one side's identity is always
 * taken from a document that holds exactly the meet's operations: equal
 * identities then mean the other side replayed every one of them too. A
 * forged history can give a shared operation id a dependency the other side
 * lacks; without that, both replays would drop it and still agree.
 *
 * A Loro runtime failure is thrown: it says nothing of either history. Any
 * other failure to read a history at the meet is a history that does not
 * match.
 */
export function compareDocumentHistories(input: {
  readonly local: HistoryDocument;
  readonly signed: HistoryDocument;
}): DocumentHistoryComparison {
  const localVersion = encodeVersionVector(input.local);
  const signedVersion = encodeVersionVector(input.signed);
  const serverAhead = !satisfiesVersionVector(localVersion, signedVersion);
  const meet = meetVersionVectors([localVersion, signedVersion]);
  try {
    return {
      matches: matchesAtMeet(input, { localVersion, meet, signedVersion }),
      serverAhead,
    };
  } catch (error) {
    if (isLoroRuntimeFailure(error)) throw error;
    return { matches: false, serverAhead };
  }
}

function matchesAtMeet(
  { local, signed }: Parameters<typeof compareDocumentHistories>[0],
  versions: {
    readonly localVersion: string;
    readonly meet: string;
    readonly signedVersion: string;
  },
): boolean {
  const { meet } = versions;
  // They share no operation id, so no operation can differ.
  if (versionVectorsEqual(meet, emptyVersionVector())) return true;
  if (versionVectorsEqual(meet, versions.localVersion)) {
    return (
      exportFullHistoryIdentity(local) ===
      exportFullHistoryIdentity(signed, meet)
    );
  }
  const signedIdentity = versionVectorsEqual(meet, versions.signedVersion)
    ? exportFullHistoryIdentity(signed)
    : identityOfCut(signed, meet);
  return (
    signedIdentity !== null &&
    signedIdentity === exportFullHistoryIdentity(local, meet)
  );
}
