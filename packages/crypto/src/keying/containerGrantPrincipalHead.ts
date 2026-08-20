import {
  normalizeReferencedPrincipalHead,
  normalizeReferencedPrincipalHeads,
} from "./accessEvent";
import { throwVerification } from "./shared";
import type {
  ContainerGrantPrincipalHead,
  ReferencedPrincipalHead,
} from "./types";

function isContainerGrantPrincipalHead(
  principalHead: ReferencedPrincipalHead,
): principalHead is ContainerGrantPrincipalHead {
  return principalHead.principalType === "group";
}

export function normalizeContainerGrantPrincipalHead(
  value: unknown,
): ContainerGrantPrincipalHead {
  const principalHead = normalizeReferencedPrincipalHead(value);
  if (!isContainerGrantPrincipalHead(principalHead)) {
    throwVerification(
      "invalid_shape",
      "container grants may reference only group principal heads",
    );
  }

  return principalHead;
}

export function normalizeContainerGrantPrincipalHeads(
  values: readonly unknown[],
): ContainerGrantPrincipalHead[] {
  const principalHeads = normalizeReferencedPrincipalHeads(values);
  if (!principalHeads.every(isContainerGrantPrincipalHead)) {
    throwVerification(
      "invalid_shape",
      "container grants may reference only group principal heads",
    );
  }

  return principalHeads;
}
