import { ApiClient } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyPageResponse,
  PrincipalProjectionMemberResponse,
} from "@tearleads/validators/response";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import { createTestTrustedUserIdentityResolver } from "../../src/data/trustedUserIdentity/testFixtures";
import type { RecoverPrincipalPolicyHistoryOptions } from "../../src/workflows/principals/principalHistoryRecoveryTypes";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";

export async function signedRecoveryHistory(
  version = 66,
  projectionAtVersion?: (
    version: number,
    userId: string,
  ) => PrincipalProjectionMemberResponse[],
) {
  const principalId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  const signer = generateSigningSeedAndKeyPair();
  const signerFingerprint = await toFingerprint(signer.signingPublicKey);
  let principalKey = generateKemSeedAndKeyPair();
  const memberKey = generateKemSeedAndKeyPair();
  const [envelope] = await wrapDekForRecipients(principalKey.secretKey, [
    memberKey.publicKey,
  ]);
  if (!envelope) throw new Error("Missing fixture envelope");
  let memberEnvelopes = [
    {
      userId,
      memberKeyFingerprint: envelope.keyFingerprint,
      kemCipherText: bytesToBase64(envelope.kemCipherText),
      wrappedKey: bytesToBase64(envelope.wrappedKey),
    },
  ];
  let bundle: PrincipalPolicyBundleResponse | undefined;
  for (let nextVersion = 1; nextVersion <= version; nextVersion += 1) {
    // Variable projections may revoke a member; rotate on every transition
    // in those fixtures so the signed chain enforces real shrink semantics.
    if (projectionAtVersion && nextVersion > 1) {
      principalKey = generateKemSeedAndKeyPair();
      const [rotated] = await wrapDekForRecipients(principalKey.secretKey, [
        memberKey.publicKey,
      ]);
      if (!rotated) throw new Error("Missing rotated fixture envelope");
      memberEnvelopes = [
        {
          userId,
          memberKeyFingerprint: rotated.keyFingerprint,
          kemCipherText: bytesToBase64(rotated.kemCipherText),
          wrappedKey: bytesToBase64(rotated.wrappedKey),
        },
      ];
    }
    const projection = projectionAtVersion?.(nextVersion, userId) ?? [
      { userId, role: "admin" as const },
    ];
    bundle = await signedPrincipalPolicyBundle({
      memberEnvelopes,
      projection,
      payloadCiphertext: "signed-recovery-fixture",
      previousStates: bundle
        ? [
            ...bundle.previousStates,
            {
              state: bundle.currentState,
              projection: bundle.currentProjection,
              grants: [],
            },
          ]
        : [],
      signing: {
        principalType: "group",
        principalId,
        version: nextVersion,
        prevStateHash: bundle?.currentState.stateHash ?? null,
        keyEpoch: projectionAtVersion ? nextVersion : 1,
        encapsulationPublicKey: bytesToBase64(principalKey.publicKey),
        keyFingerprint: await toFingerprint(principalKey.publicKey),
        externalAuthority: null,
        signedAt: "2026-10-06T00:00:00.000Z",
        signerUserId: userId,
        signerUserKeyFingerprint: signerFingerprint,
      },
      signingPrivateKey: signer.signingPrivateKey,
    });
  }
  if (!bundle) throw new Error("Empty recovery fixture");
  return {
    bundle,
    signingPrivateKey: signer.signingPrivateKey,
    expectedHead: principalPolicyHead(bundle),
    resolveTrustedUserIdentity: createTestTrustedUserIdentityResolver({
      userId,
      signingPublicKey: signer.signingPublicKey,
      signingKeyFingerprint: signerFingerprint,
    }),
  };
}

export function serveRecoveryHistory(
  bundle: PrincipalPolicyBundleResponse,
  retained: readonly PrincipalPolicyBundleResponse[] = [],
) {
  const pins = new Map(
    [bundle, ...retained].map((policy) => [
      policy.currentState.stateHash,
      policy,
    ]),
  );
  const requests: number[] = [];
  const controls: {
    failAfterVersion: number | null;
    mutate: ((page: PrincipalPolicyPageResponse) => void) | null;
  } = { failAfterVersion: null, mutate: null };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const query = new URL(request.url).searchParams;
      const pinned = pins.get(query.get("stateHash") ?? "") ?? bundle;
      const after = Number(query.get("afterVersion") ?? 0);
      requests.push(after);
      if (controls.failAfterVersion === after)
        return new Response("Interrupted", { status: 503 });
      const previousStates = pinned.previousStates.slice(after, after + 32);
      const next = after + previousStates.length;
      const page: PrincipalPolicyPageResponse = structuredClone({
        ...pinned,
        previousStates,
        historyPage: {
          afterVersion: after,
          nextAfterVersion:
            next === pinned.currentState.version - 1 ? null : next,
        },
      });
      controls.mutate?.(page);
      return Response.json(page);
    },
  });
  return {
    requests,
    controls,
    client: () => new ApiClient(`http://127.0.0.1:${server.port}`),
    close: () => server.stop(true),
  };
}

export async function createRecoveryFixture(
  history: Awaited<ReturnType<typeof signedRecoveryHistory>>,
  retained: Parameters<typeof serveRecoveryHistory>[1] = [],
) {
  const sqlite = await createTestExecSql("principal-history-recovery");
  const http = serveRecoveryHistory(history.bundle, retained);
  const options: RecoverPrincipalPolicyHistoryOptions = {
    apiClient: http.client(),
    execSql: sqlite.execSql,
    organizationId: "org-1",
    expectedHead: history.expectedHead,
    protection: {
      localKey: new Uint8Array(32).fill(7),
      context: "device-and-trust-domain-1",
    },
    resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
    stillCurrent: () => true,
  };
  const db = getClientSQLitePersistenceRuntime(sqlite.execSql).db;
  return {
    ...http,
    options,
    db,
    close() {
      http.close();
      sqlite.close();
    },
  };
}
