/** Fields shared by compact attribution intervals and detailed upload ranges. */
export interface DocumentAttributionInterval {
  peerId: string;
  startCounter: number;
  endCounter: number;
  writerUserId: string;
  writerKeyFingerprint: string;
  authorityKind: "direct" | "baseline";
}
