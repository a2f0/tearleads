import type {
  PrincipalPolicyExternalAuthority,
  PrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import type { ProjectionPolicyEvidenceResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { PublicPrincipalHistoryOptions } from "./publicPrincipalHistoryTypes";
import { publicProjectionDirectoryBindings } from "./publicProjectionDirectory";
import {
  type PublicProjectionPrincipal,
  recoverPublicProjectionPrincipal,
  rejectPublicProjection,
  selectPublicProjectionPrincipal,
} from "./publicProjectionPrincipal";

export interface ProjectionPolicyHistoryRecoveryOptions
  extends Omit<
    PublicPrincipalHistoryOptions,
    | "source"
    | "loadExternalAuthority"
    | "strictAdmins"
    | "authorityGroupId"
    | "replay"
  > {
  readonly evidence: ProjectionPolicyEvidenceResponse;
  readonly references: readonly ReferencedPrincipalHead[];
}

function assertSourceCoverage(
  evidence: ProjectionPolicyEvidenceResponse,
  references: readonly ReferencedPrincipalHead[],
): void {
  const sources = [evidence.organization, ...evidence.groups];
  for (const reference of references)
    if (
      !sources.some(
        (source) =>
          source &&
          source.head.principalType === reference.principalType &&
          source.head.principalId === reference.principalId &&
          source.head.version >= reference.version,
      )
    )
      rejectPublicProjection("required citation has no covering source");
}

async function externalAuthority(
  admins: PublicProjectionPrincipal,
  entries: readonly PrincipalPolicyStateChainEntry[],
): Promise<PrincipalPolicyExternalAuthority | undefined> {
  const head = admins.options.source.head;
  const references = entries.flatMap(({ state }) =>
    state.externalAuthority ? [state.externalAuthority] : [],
  );
  if (!references.length) return undefined;
  if (
    references.some(
      (reference) =>
        reference.principalId !== head.principalId ||
        reference.version > head.version,
    )
  )
    rejectPublicProjection(
      "external authority exceeds the bound Admins source",
    );
  const policies = await selectPublicProjectionPrincipal(admins, references);
  const states = new Map(
    policies.flatMap((policy) =>
      policy.retainedHistory.map(
        ({ state, projection }) =>
          [
            state.version,
            {
              head: {
                principalType: "group" as const,
                principalId: state.principalId,
                version: state.version,
                stateHash: state.stateHash,
                keyEpoch: state.keyEpoch,
                keyFingerprint: state.keyFingerprint,
              },
              projection,
            },
          ] as const,
      ),
    ),
  );
  return {
    currentHead: { ...head, principalType: "group" },
    states: [...states.values()],
  };
}

/** Public authorization only; no current-policy cache or checkpoint is written. */
export async function recoverProjectionPolicyHistory(
  input: ProjectionPolicyHistoryRecoveryOptions,
): Promise<VerifiedPrincipalPolicySelection[]> {
  assertProjectionVerificationCurrent(
    () => !input.signal?.aborted && input.stillCurrent(),
  );
  input = { ...input, references: structuredClone(input.references) };
  const evidence = structuredClone(input.evidence);
  assertSourceCoverage(evidence, input.references);
  if (!evidence.organization) {
    if (evidence.groups.length || evidence.organizationPayloads.length)
      rejectPublicProjection("group evidence requires organization history");
    return [];
  }
  if (evidence.organization.head.principalType !== "organization")
    rejectPublicProjection("organization source has the wrong principal type");
  const organization = await recoverPublicProjectionPrincipal(
    {
      ...input,
      source: evidence.organization,
    },
    [
      ...input.references,
      ...evidence.organizationPayloads.map(({ reference }) => reference),
    ],
  );
  const bindings = await publicProjectionDirectoryBindings(
    evidence,
    organization,
  );
  const principals = new Map<string, PublicProjectionPrincipal>();
  const adminHeads = [...bindings.values()].map(({ adminHead }) => adminHead);
  for (const adminId of new Set(adminHeads.map((head) => head.principalId))) {
    const source = evidence.groups.find(
      (group) => group.head.principalId === adminId,
    );
    if (!source) rejectPublicProjection("signed Admins source is missing");
    principals.set(
      adminId,
      await recoverPublicProjectionPrincipal(
        { ...input, source, strictAdmins: true },
        [...input.references, ...adminHeads],
      ),
    );
  }
  for (const source of evidence.groups) {
    if (principals.has(source.head.principalId)) continue;
    const binding = bindings.get(source.head.principalId);
    const admins = binding && principals.get(binding.adminHead.principalId);
    if (!admins) rejectPublicProjection("verified Admins history is missing");
    principals.set(
      source.head.principalId,
      await recoverPublicProjectionPrincipal(
        {
          ...input,
          source,
          authorityGroupId: admins.options.source.head.principalId,
          loadExternalAuthority: (entries) =>
            externalAuthority(admins, entries),
        },
        input.references,
      ),
    );
  }
  const policies: VerifiedPrincipalPolicySelection[] = [];
  for (const principal of [organization, ...principals.values()])
    policies.push(...(await selectPublicProjectionPrincipal(principal)));
  return policies;
}
