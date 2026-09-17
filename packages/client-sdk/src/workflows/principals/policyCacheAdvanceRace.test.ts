import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import { createPolicyDirectoryFixture } from "../../../test/helpers/policyDirectoryFixtures";
import { signedPrincipalPolicyBundle } from "../../../test/helpers/principalPolicyFixtures";
import { trustedUserIdentityFromResponse } from "../../../test/helpers/trustedUserIdentity";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";
import {
  cachePrincipalPolicyBundles,
  cacheReferencedPrincipalPolicies,
} from "./policyCache";

test.each([false, true])(
  "a directory advancing during cache verification retries current authority (replay=%s)",
  async (replay) => {
    const { close, execSql } = await createTestExecSql(
      "policy-cache-advance-race",
    );
    try {
      const group = await createPrincipalPolicyBundle();
      const directory = await createPolicyDirectoryFixture({
        organizationId: "org-1",
        group: group.bundle,
      });
      const previous = directory.bundle;
      const current = await signedPrincipalPolicyBundle({
        memberEnvelopes: previous.currentMemberEnvelopes.envelopes,
        payloadCiphertext: previous.currentPayload.ciphertext,
        projection: previous.currentProjection,
        previousStates: [
          {
            state: previous.currentState,
            projection: previous.currentProjection,
            grants: previous.currentGrants,
          },
        ],
        signing: {
          ...previous.currentState,
          grants: previous.currentGrants,
          version: 2,
          prevStateHash: previous.currentState.stateHash,
          signedAt: new Date(
            Date.parse(previous.currentState.signedAt) + 1_000,
          ).toISOString(),
        },
        signingPrivateKey: directory.signingKeyPair.signingPrivateKey,
      });
      const resolveIdentity = async (id: string) =>
        trustedUserIdentityFromResponse(
          id === directory.signer.userId
            ? directory.signer
            : group.signerKeyResponse,
        );
      await savePrincipalPolicyBundle(
        execSql,
        previous,
        new Date().toISOString(),
        "org-1",
      );
      let advanced = false;
      let groupReads = 0;
      let directoryReads = 0;
      const incidents: unknown[] = [];
      const warming = cacheReferencedPrincipalPolicies({
        execSql,
        organizationId: "org-1",
        references: [referencedPrincipalStateFromBundle(group.bundle)],
        getCurrentPrincipalPolicy: async (kind) => {
          if (kind === "group") {
            groupReads += 1;
            return group.bundle;
          }
          directoryReads += 1;
          return replay ? previous : current;
        },
        reportSecurityIncident: async (error) => {
          incidents.push(error);
        },
        resolveTrustedUserIdentity: async (id) => {
          // The warmer has already captured v1 and its checkpoint. A concurrent
          // signed update commits v2 before that verified v1 reaches persistence.
          if (id === directory.signer.userId && !advanced) {
            advanced = true;
            await cachePrincipalPolicyBundles({
              bundles: [current],
              execSql,
              organizationId: "org-1",
              getCurrentPrincipalPolicy: async () => current,
              reportSecurityIncident: async (error) => {
                throw error;
              },
              resolveTrustedUserIdentity: resolveIdentity,
            });
          }
          return resolveIdentity(id);
        },
      });
      if (replay)
        await expect(warming).rejects.toMatchObject({ code: "rollback" });
      else await warming;
      expect(advanced).toBe(true);
      expect(groupReads).toBe(2);
      expect(directoryReads).toBe(1);
      expect(incidents).toHaveLength(replay ? 1 : 0);
      expect(
        await loadPrincipalPolicyCheckpoint(execSql, "organization", "org-1"),
      ).toMatchObject({
        version: 2,
        stateHash: current.currentState.stateHash,
      });
      const stored = await loadPrincipalPolicyBundle(
        execSql,
        "group",
        "group-1",
      );
      if (replay) expect(stored).toBeNull();
      else
        expect(stored?.currentState.stateHash).toBe(
          group.bundle.currentState.stateHash,
        );
    } finally {
      close();
    }
  },
);
