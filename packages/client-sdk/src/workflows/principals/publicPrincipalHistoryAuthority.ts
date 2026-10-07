import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { isReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import type { PublicPrincipalHistoryOptions } from "./publicPrincipalHistoryTypes";

/** The greatest cited Admins head commits to the lineage of every earlier citation. */
export function publicHistoryAuthorityReference(
  previous: ReferencedPrincipalHead | null,
  references: readonly ReferencedPrincipalHead[],
) {
  return references.reduce<ReferencedPrincipalHead | null>(
    (head, reference) =>
      !head || reference.version > head.version ? reference : head,
    previous,
  );
}

export function publicHistoryAuthorityJson(
  reference: ReferencedPrincipalHead | null,
) {
  return serializeKeyingCanonicalJson(reference ? { ...reference } : null);
}

export function parsePublicHistoryAuthority(
  input: PublicPrincipalHistoryOptions,
  json: string,
): ReferencedPrincipalHead | null | undefined {
  try {
    const value: unknown = JSON.parse(json);
    if (value === null) return null;
    if (
      isReferencedPrincipalStateResponse(value) &&
      value.principalType === "group" &&
      value.principalId === input.authorityGroupId
    )
      return value;
  } catch {
    /* Invalid disposable metadata cannot restore verified progress. */
  }
  return undefined;
}

export async function loadPublicHistoryAuthority(
  input: PublicPrincipalHistoryOptions,
  references: readonly ReferencedPrincipalHead[],
  cachedPrefix = false,
) {
  if (!references.length) return undefined;
  const authority = await input.loadExternalAuthority?.(
    references,
    cachedPrefix,
  );
  if (
    authority &&
    (authority.currentHead.principalId !== input.authorityGroupId ||
      authority.states.some(
        ({ head }) => head.principalId !== input.authorityGroupId,
      ))
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Authority callback differs from the directory binding",
    );
  if (
    references.some(
      (reference) =>
        !authority?.states.some(({ head }) =>
          principalHeadMatchesReference(head, reference),
        ),
    )
  )
    throw new KeyingVerificationError(
      "stale_predecessor",
      "Public history authority differs from its verified Admins lineage",
    );
  return authority;
}

export async function validatePublicHistoryAuthority(
  input: PublicPrincipalHistoryOptions,
  reference: ReferencedPrincipalHead | null,
): Promise<void> {
  try {
    if (reference) await loadPublicHistoryAuthority(input, [reference], true);
  } catch (error) {
    if (error instanceof KeyingVerificationError)
      throw new PublicHistoryAuthorityUnavailableError(error);
    throw error;
  }
}

/** Only cache restoration can request a replay after an authority mismatch. */
export class PublicHistoryAuthorityUnavailableError extends Error {
  constructor(readonly verificationError: KeyingVerificationError) {
    super(verificationError.message);
    this.name = "PublicHistoryAuthorityUnavailableError";
  }
}
