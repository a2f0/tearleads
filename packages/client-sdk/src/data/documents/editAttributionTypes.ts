/** Fields shared by compact attribution intervals and detailed upload ranges. */
export interface DocumentAttributionInterval {
  peerId: string;
  startCounter: number;
  endCounter: number;
  writerUserId: string;
  writerKeyFingerprint: string;
  authorityKind: "direct" | "baseline";
}

/** One key per signing identity: NUL cannot appear in either field. */
export function signingIdentityKey(identity: {
  readonly writerUserId: string;
  readonly writerKeyFingerprint: string;
}): string {
  return `${identity.writerUserId}\u0000${identity.writerKeyFingerprint}`;
}
