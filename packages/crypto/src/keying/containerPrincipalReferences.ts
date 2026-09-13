import { referencedPrincipalKey } from "./accessEvent";
import { normalizeContainerGrantPrincipalHeads } from "./containerGrantPrincipalHead";
import { throwVerification } from "./shared";
import type {
  ContainerDirectGrant,
  ContainerGrantPrincipalHead,
} from "./types";

export function upsertReferencedPrincipalHead(
  principalHeads: readonly ContainerGrantPrincipalHead[],
  principalHead: ContainerGrantPrincipalHead,
): ContainerGrantPrincipalHead[] {
  const nextPrincipalHeads = principalHeads.filter(
    (existingHead) =>
      referencedPrincipalKey(existingHead) !==
      referencedPrincipalKey(principalHead),
  );
  nextPrincipalHeads.push(principalHead);
  return normalizeContainerGrantPrincipalHeads(nextPrincipalHeads);
}

export function removeReferencedPrincipalHead(
  principalHeads: readonly ContainerGrantPrincipalHead[],
  revokedGrant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): ContainerGrantPrincipalHead[] {
  if (revokedGrant.subjectType === "user") {
    return normalizeContainerGrantPrincipalHeads(principalHeads);
  }

  const revokedReferenceKey = `${revokedGrant.subjectType}:${revokedGrant.subjectId}`;
  return normalizeContainerGrantPrincipalHeads(
    principalHeads.filter(
      (principalHead) =>
        referencedPrincipalKey(principalHead) !== revokedReferenceKey,
    ),
  );
}

export function assertContainerPrincipalReferencesProgress(
  previous: readonly ContainerGrantPrincipalHead[],
  next: readonly ContainerGrantPrincipalHead[],
): void {
  const previousById = new Map(
    previous.map((head) => [referencedPrincipalKey(head), head]),
  );
  for (const head of next) {
    const prior = previousById.get(referencedPrincipalKey(head));
    if (!prior) continue;
    if (head.version < prior.version || head.keyEpoch < prior.keyEpoch) {
      throwVerification(
        "rollback",
        "Container principal reference regresses below its signed predecessor",
      );
    }
    if (
      head.version === prior.version &&
      (head.stateHash !== prior.stateHash ||
        head.keyEpoch !== prior.keyEpoch ||
        head.keyFingerprint !== prior.keyFingerprint)
    ) {
      throwVerification(
        "equivocation",
        "Container principal reference conflicts at the same version",
      );
    }
  }
}
