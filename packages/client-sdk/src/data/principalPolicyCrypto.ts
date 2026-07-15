import { type RecipientEntry, unwrapDek } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  PrincipalMemberEnvelopeResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import type { SerializedKeyEnvelope } from "@tearleads/validators/util";
import { loadAllPrincipalPolicyBundles } from "./persistence/principalPolicyPersistence";
import type { ExecSql } from "./sqlite/sqlSchema";

interface PrincipalPolicyResolutionContext {
  bundlesByKeyFingerprint: ReadonlyMap<
    string,
    ReadonlyArray<PrincipalPolicyBundleResponse>
  >;
  resolvedPrincipalSecretKeys: Map<string, Uint8Array>;
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
    PrincipalPolicyBundleResponse["currentState"],
    "principalType" | "principalId"
  >,
): string {
  return `${bundle.principalType}:${bundle.principalId}`;
}

async function createPrincipalPolicyResolutionContext(
  execSql: ExecSql,
): Promise<PrincipalPolicyResolutionContext> {
  const bundles = await loadAllPrincipalPolicyBundles(execSql);
  const bundlesByKeyFingerprint = new Map<
    string,
    PrincipalPolicyBundleResponse[]
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
    resolvedPrincipalSecretKeys: new Map(),
  };
}

async function unwrapThroughNestedGroup(input: {
  context: PrincipalPolicyResolutionContext;
  memberEnvelopeEntries: RecipientEntry[];
  memberEnvelopes: ReadonlyArray<PrincipalMemberEnvelopeResponse>;
  nextVisitingPrincipalKeys: Set<string>;
  policyEpochKey: string;
  secretKey: Uint8Array;
}): Promise<Uint8Array | null> {
  for (const memberEnvelope of input.memberEnvelopes) {
    if (memberEnvelope.memberPrincipalType !== "group") {
      continue;
    }
    const nestedBundles =
      input.context.bundlesByKeyFingerprint.get(
        memberEnvelope.memberKeyFingerprint,
      ) ?? [];
    for (const nestedBundle of nestedBundles) {
      if (
        nestedBundle.currentState.principalType !== "group" ||
        nestedBundle.currentState.principalId !==
          memberEnvelope.memberPrincipalId
      ) {
        continue;
      }
      try {
        const nestedSecretKey = await unwrapPrincipalSecretKey(
          nestedBundle,
          input.secretKey,
          input.context,
          input.nextVisitingPrincipalKeys,
        );
        const resolvedSecretKey = await unwrapDek(
          input.memberEnvelopeEntries,
          nestedSecretKey,
        );
        input.context.resolvedPrincipalSecretKeys.set(
          input.policyEpochKey,
          resolvedSecretKey,
        );
        return resolvedSecretKey;
      } catch {}
    }
  }
  return null;
}

async function unwrapPrincipalSecretKey(
  bundle: PrincipalPolicyBundleResponse,
  secretKey: Uint8Array,
  context: PrincipalPolicyResolutionContext,
  visitingPrincipalKeys: Set<string>,
): Promise<Uint8Array> {
  const principalKey = principalBundleKey(bundle.currentState);
  const policyEpochKey = `${principalKey}:${bundle.currentState.stateHash}`;
  const cachedSecretKey =
    context.resolvedPrincipalSecretKeys.get(policyEpochKey) ?? null;

  if (cachedSecretKey) {
    return cachedSecretKey;
  }

  if (visitingPrincipalKeys.has(policyEpochKey)) {
    throw new Error(`Principal policy cycle detected for ${principalKey}`);
  }

  const nextVisitingPrincipalKeys = new Set(visitingPrincipalKeys);
  nextVisitingPrincipalKeys.add(policyEpochKey);
  const memberEnvelopeEntries = toMemberEnvelopeEntries(
    bundle.currentMemberEnvelopes.envelopes,
  );

  try {
    const resolvedSecretKey = await unwrapDek(memberEnvelopeEntries, secretKey);
    context.resolvedPrincipalSecretKeys.set(policyEpochKey, resolvedSecretKey);
    return resolvedSecretKey;
  } catch {
    const nestedSecretKey = await unwrapThroughNestedGroup({
      context,
      memberEnvelopeEntries,
      memberEnvelopes: bundle.currentMemberEnvelopes.envelopes,
      nextVisitingPrincipalKeys,
      policyEpochKey,
      secretKey,
    });
    if (nestedSecretKey) {
      return nestedSecretKey;
    }
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

  const context = await createPrincipalPolicyResolutionContext(input.execSql);
  const attemptedPrincipalKeys = new Set<string>();

  for (const envelope of input.envelopes) {
    const candidateBundles =
      context.bundlesByKeyFingerprint.get(envelope.keyFingerprint) ?? [];

    for (const bundle of candidateBundles) {
      const principalKey = principalBundleKey(bundle.currentState);

      if (attemptedPrincipalKeys.has(principalKey)) {
        continue;
      }

      attemptedPrincipalKeys.add(principalKey);

      try {
        const principalSecretKey = await unwrapPrincipalSecretKey(
          bundle,
          input.secretKey,
          context,
          new Set(),
        );

        return await unwrapDek(keyEntries, principalSecretKey);
      } catch {}
    }
  }

  throw new Error(
    "No matching key envelope entry found for this secret key or cached principal policies",
  );
}
