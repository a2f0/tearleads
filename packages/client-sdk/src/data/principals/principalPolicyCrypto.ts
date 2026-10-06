import { type RecipientEntry, unwrapDek } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { PrincipalMemberEnvelopeResponse } from "@tearleads/validators/response";
import type { SerializedKeyEnvelope } from "@tearleads/validators/util";
import {
  loadPrincipalKeyEnvelopeCandidates,
  type PrincipalKeyEnvelopeCandidate,
} from "../persistence/principalKeyEnvelopeCandidates";
import type { ExecSql } from "../sqlite/sqlSchema";

interface PrincipalPolicyResolutionContext {
  bundlesByKeyFingerprint: ReadonlyMap<
    string,
    ReadonlyArray<PrincipalKeyEnvelopeCandidate>
  >;
}

function toKeyEnvelopeEntries(
  envelopes: ReadonlyArray<SerializedKeyEnvelope>,
): RecipientEntry[] {
  return envelopes.map((envelope) => ({
    keyFingerprint: envelope.keyFingerprint,
    kemCipherText: base64ToBytes(envelope.kemCipherText),
    wrappedKey: base64ToBytes(envelope.wrappedKey),
  }));
}

function toMemberEnvelopeEntries(
  envelopes: ReadonlyArray<PrincipalMemberEnvelopeResponse>,
): RecipientEntry[] {
  return envelopes.map((envelope) => ({
    keyFingerprint: envelope.memberKeyFingerprint,
    kemCipherText: base64ToBytes(envelope.kemCipherText),
    wrappedKey: base64ToBytes(envelope.wrappedKey),
  }));
}

function principalBundleKey(
  bundle: Pick<
    PrincipalKeyEnvelopeCandidate["currentState"],
    "principalType" | "principalId"
  >,
): string {
  return `${bundle.principalType}:${bundle.principalId}`;
}

async function createPrincipalPolicyResolutionContext(
  execSql: ExecSql,
  fingerprints: readonly string[],
): Promise<PrincipalPolicyResolutionContext> {
  const bundles = await loadPrincipalKeyEnvelopeCandidates(
    execSql,
    fingerprints,
  );
  const bundlesByKeyFingerprint = new Map<
    string,
    PrincipalKeyEnvelopeCandidate[]
  >();

  for (const bundle of bundles) {
    const matchingBundles =
      bundlesByKeyFingerprint.get(bundle.currentState.keyFingerprint) ?? [];
    matchingBundles.push(bundle);
    bundlesByKeyFingerprint.set(
      bundle.currentState.keyFingerprint,
      matchingBundles,
    );
  }

  return {
    bundlesByKeyFingerprint,
  };
}

async function unwrapPrincipalSecretKey(
  bundle: PrincipalKeyEnvelopeCandidate,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  const principalKey = principalBundleKey(bundle.currentState);
  const memberEnvelopeEntries = toMemberEnvelopeEntries(
    bundle.currentMemberEnvelopes.envelopes,
  );

  try {
    return await unwrapDek(memberEnvelopeEntries, secretKey);
  } catch {
    // No transitive fallback: a principal's envelopes are all addressed to
    // users directly, so if this identity key opens none of them the requester
    // is not a member.
  }

  throw new Error(`No matching principal member envelope for ${principalKey}`);
}

export async function unwrapKeyEnvelopesWithPrincipalPolicies(input: {
  envelopes: ReadonlyArray<SerializedKeyEnvelope>;
  execSql?: ExecSql | undefined;
  secretKey: Uint8Array;
}): Promise<Uint8Array> {
  const keyEntries = toKeyEnvelopeEntries(input.envelopes);

  try {
    return await unwrapDek(keyEntries, input.secretKey);
  } catch {
    if (!input.execSql) {
      throw new Error(
        "No matching key envelope entry found for this secret key and no principal policy cache is available",
      );
    }
  }

  const context = await createPrincipalPolicyResolutionContext(
    input.execSql,
    input.envelopes.map((envelope) => envelope.keyFingerprint),
  );
  const attemptedFingerprints = new Set<string>();

  for (const envelope of input.envelopes) {
    if (attemptedFingerprints.has(envelope.keyFingerprint)) continue;
    attemptedFingerprints.add(envelope.keyFingerprint);
    const candidateBundles =
      context.bundlesByKeyFingerprint.get(envelope.keyFingerprint) ?? [];

    for (const bundle of candidateBundles) {
      try {
        const principalSecretKey = await unwrapPrincipalSecretKey(
          bundle,
          input.secretKey,
        );

        return await unwrapDek(keyEntries, principalSecretKey);
      } catch {}
    }
  }

  throw new Error(
    "No matching key envelope entry found for this secret key or cached principal policies",
  );
}
