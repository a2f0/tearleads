import { ApiClient } from "@tearleads/api-client";
import {
  AES_GCM_TAG_BYTES,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
  toFingerprint,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { createProjectionCheckpointContext } from "../../src/data/keyingProjectionVerification/checkpoints/checkpointContext";
import { principalPolicyCacheForVerifiedPolicies } from "../../src/data/keyingProjectionVerification/principalPolicy/principalPolicyCache";
import { collectReferencedPrincipalPolicies } from "../../src/data/keyingProjectionVerification/principalPolicy/principalPolicyVerification";
import { trustedUserIdentityPinTables } from "../../src/data/sqlite/schema/trustedUserIdentityPinSchema";
import {
  createExecSql,
  ensureSqlTables,
} from "../../src/data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../src/data/trustedUserIdentity";
import {
  createApiUserIdentitySource,
  createTrustedUserIdentityService,
} from "../../src/data/trustedUserIdentity";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";
import {
  createFixtureUserIdentity,
  fixtureProjectionMember,
} from "./trustedUserIdentity";

/**
 * One verified group policy over real identities. `removeLastMember` signs a
 * rotated version 2 without the last member, who then appears only in the
 * policy's history.
 */
export async function principalIdentityPinFixture(
  memberCount = 8,
  options: { readonly removeLastMember?: boolean } = {},
) {
  const signing = generateSigningSeedAndKeyPair();
  const members = await Promise.all(
    Array.from({ length: memberCount }, (_, index) =>
      createFixtureUserIdentity({
        userId: crypto.randomUUID(),
        ...(index === 0 ? { signingPublicKey: signing.signingPublicKey } : {}),
      }),
    ),
  );
  const signer = members[0];
  if (!signer) throw new Error("Expected a signer");
  const kem = generateKemSeedAndKeyPair();
  const memberEnvelope = (member: (typeof members)[number]) => ({
    userId: member.response.userId,
    memberKeyFingerprint: member.response.encapsulationKeyFingerprint,
    kemCipherText: bytesToBase64(new Uint8Array(ML_KEM1024_CIPHERTEXT_BYTES)),
    wrappedKey: bytesToBase64(
      new Uint8Array(ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES),
    ),
  });
  const genesis = await signedPrincipalPolicyBundle({
    projection: members.map((member, index) =>
      fixtureProjectionMember(member, index === 0 ? "admin" : "member"),
    ),
    memberEnvelopes: members.map(memberEnvelope),
    payloadCiphertext: "identity-pin-policy",
    signing: {
      principalType: "group",
      principalId: crypto.randomUUID(),
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(kem.publicKey),
      keyFingerprint: await toFingerprint(kem.publicKey),
      externalAuthority: null,
      signedAt: "2026-11-11T00:00:00.000Z",
      signerUserId: signer.identity.userId,
      signerUserKeyFingerprint: signer.identity.signingKeyFingerprint,
    },
    signingPrivateKey: signing.signingPrivateKey,
  });
  const rotated = generateKemSeedAndKeyPair();
  const bundle = options.removeLastMember
    ? await signedPrincipalPolicyBundle({
        projection: genesis.currentProjection.slice(0, -1),
        memberEnvelopes: members.slice(0, -1).map(memberEnvelope),
        payloadCiphertext: "identity-pin-policy",
        previousStates: [
          {
            state: genesis.currentState,
            projection: genesis.currentProjection,
            grants: genesis.currentGrants,
          },
        ],
        signing: {
          ...genesis.currentState,
          version: 2,
          prevStateHash: genesis.currentState.stateHash,
          keyEpoch: 2,
          encapsulationPublicKey: bytesToBase64(rotated.publicKey),
          keyFingerprint: await toFingerprint(rotated.publicKey),
        },
        signingPrivateKey: signing.signingPrivateKey,
      })
    : genesis;
  const verified = await verifyPrincipalPolicyBundle({
    bundle,
    signerPublicKeys: [signer.identity],
  });
  if (!verified.ok) throw verified.error;
  const database = await createTestExecSql("principal-identity-pins");
  const statements: string[] = [];
  let afterSql: ((sql: string) => void | Promise<void>) | undefined;
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      statements.push(sql.toLowerCase());
      const rows = await database.execSql(
        sql,
        bind,
        rowMode ? { rowMode } : undefined,
      );
      await afterSql?.(sql.toLowerCase());
      return { rows };
    },
  });
  const responses = new Map(
    members.map((member) => [member.identity.userId, member.response]),
  );
  const requests: string[] = [];
  const loads: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const userId = new URL(request.url).pathname.split("/").at(-1) ?? "";
      requests.push(userId);
      const response = responses.get(userId);
      return response
        ? Response.json(response)
        : new Response(null, { status: 404 });
    },
  });
  const scope = {
    execSql: execSql as typeof execSql | null,
    localUserId: null as string | null,
  };
  /** A fresh endpoint cache and service over the same durable trust store. */
  const startService = () => {
    const api = new ApiClient(server.url.origin);
    const remote = createApiUserIdentitySource(api);
    const service = createTrustedUserIdentityService({
      getExecSql: () => scope.execSql,
      getLocalUserId: () => scope.localUserId,
      getLocalIdentity: (userId) =>
        members.find((member) => member.identity.userId === userId)?.identity ??
        null,
      identityTrustDomain: "https://api.example.test",
      remoteSource: {
        invalidate: remote.invalidate,
        load: (userId) => {
          loads.push(userId);
          return remote.load(userId);
        },
      },
    });
    return { api, service };
  };
  const { api, service } = startService();
  await ensureSqlTables(execSql, trustedUserIdentityPinTables);
  const cache = principalPolicyCacheForVerifiedPolicies([verified.value]);
  const checkpointContext = createProjectionCheckpointContext({ execSql });
  const verify = (
    resolveUserKey: TrustedUserIdentityResolver = service.resolve,
  ) =>
    collectReferencedPrincipalPolicies({
      checkpointContext,
      organizationId: "organization-1",
      principalPolicyCache: cache,
      references: [principalPolicyHead(bundle)],
      resolveUserKey,
    });
  const resetCounts = () => {
    statements.length = 0;
    loads.length = 0;
    requests.length = 0;
  };
  const counts = () => ({
    sql: statements.length,
    pinSelects: statements.filter(
      (sql) =>
        sql.startsWith("select") && sql.includes("trusted_user_identity_pins"),
    ).length,
    transactions: statements.filter((sql) => sql.startsWith("begin")).length,
    writes: statements.filter((sql) => /^(insert|update|delete)/.test(sql))
      .length,
    loads: loads.length,
    requests: requests.length,
  });
  return {
    api,
    bundle,
    cache,
    checkpointContext,
    counts,
    execSql,
    members,
    requests,
    resetCounts,
    responses,
    scope,
    service,
    statements,
    verify,
    afterSql: (callback: typeof afterSql) => {
      afterSql = callback;
    },
    /** Restart the app: in-memory answers are gone, durable pins remain. */
    restart: startService,
    close() {
      server.stop(true);
      database.close();
    },
  };
}
