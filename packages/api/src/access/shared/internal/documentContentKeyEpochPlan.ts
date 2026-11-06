import { DocumentContentKeyBundleError } from "./documentContentKeyTargets";

/**
 * How a submitted document content-key epoch relates to the latest stored
 * one. `first`: nothing is stored yet. `carry`: the same epoch, whose stored
 * targets the current KEK targets can still carry, so the submission may add
 * targets to it. `rotate`: a newer epoch. An older epoch, or the same epoch
 * after a linked container's key material changed, is refused here.
 */
export type DocumentContentKeyEpochPlan =
  | { readonly kind: "first" }
  | { readonly kind: "carry" }
  | { readonly kind: "rotate" };

export function planDocumentContentKeyEpoch(input: {
  readonly contentKeyEpoch: number;
  readonly latestContentKeyEpoch: number | null;
  readonly latestTargetsStillCurrent: () => boolean;
}): DocumentContentKeyEpochPlan {
  const latest = input.latestContentKeyEpoch;
  if (latest === null) {
    return { kind: "first" };
  }
  if (input.contentKeyEpoch < latest) {
    throw new DocumentContentKeyBundleError(
      "Document content key epoch is stale",
      409,
    );
  }
  if (input.contentKeyEpoch > latest) {
    return { kind: "rotate" };
  }
  if (!input.latestTargetsStillCurrent()) {
    throw new DocumentContentKeyBundleError(
      "Document content key epoch must rotate after target key material changes",
      409,
    );
  }
  return { kind: "carry" };
}
