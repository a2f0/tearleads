import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createAuthorityRecoveryFixture } from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createReservedGroupAdvance } from "../../../test/helpers/reservedGroupAdvance";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyCurrentResolver } from "../principals/runtimePolicyRecovery";
import {
  createCurrentGroupMetadataContainerVerifier,
  createSelectedCurrentGroupMetadataContainerVerifier,
} from "./currentGroupMetadataAuthority";
import { loadCurrentOrganizationAuthority } from "./currentOrganizationAuthority";
import { MetadataRootBehindDirectoryError } from "./groupMetadataErrors";

test.each([
  ["Admins", false],
  ["Members", false],
  ["Admins", true],
  ["Members", true],
] as const)(
  "bounded metadata authority proves the old %s citation (selected=%s)",
  async (advancing, selected) => {
    const signed = await createReservedGroupAdvance(advancing);
    const f = await createAuthorityRecoveryFixture({
      directory: signed.advancedDirectory,
      admin: await signed.currentPolicy(
        "group",
        signed.admin.currentState.principalId,
      ),
      group: await signed.currentPolicy(
        "group",
        signed.members.currentState.principalId,
      ),
      organizationId: signed.artifacts.organizationId,
      resolveTrustedUserIdentity: signed.resolveTrustedUserIdentity,
    });
    let fullReads = 0;
    f.options.apiClient.getCurrentPrincipalPolicy = async () => {
      fullReads += 1;
      throw new Error("Full policy reads are forbidden");
    };
    const state = { online: true, current: true };
    const resolveCurrentPolicy = createRuntimePrincipalPolicyCurrentResolver({
      apiClient: f.options.apiClient,
      infra: { execSql: f.options.execSql },
      resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
      state,
      util: { reportSecurityIncident: async () => {} },
      withPrincipalHistoryProtection: async (work) =>
        work({
          protection: f.options.protection,
          stillCurrent: () => state.current,
        }),
    });
    if (!resolveCurrentPolicy) throw new Error("Missing current resolver");
    const input = {
      execSql: f.options.execSql,
      organizationId: signed.artifacts.organizationId,
      resolveCurrentPolicy,
      stillCurrent: () => state.current,
    };
    try {
      const verify = selected
        ? createSelectedCurrentGroupMetadataContainerVerifier({
            ...input,
            authority: await loadCurrentOrganizationAuthority(input),
          })
        : createCurrentGroupMetadataContainerVerifier(input);
      const initialRequests = f.requests.length;
      const directoryReads = () =>
        f.requests.filter(
          (request) => request.principalId === signed.artifacts.organizationId,
        ).length;
      const initialDirectoryReads = directoryReads();
      await expect(
        verify(signed.state, {
          ...principalPolicyHead(signed.advancedDirectory),
          principalId: "foreign-organization",
        }),
      ).rejects.toMatchObject({
        code: "object_mismatch",
        message: "Current policy reference is outside its scope",
      });
      expect(f.requests).toHaveLength(initialRequests);
      await expect(verify(signed.state)).rejects.toBeInstanceOf(
        MetadataRootBehindDirectoryError,
      );
      await expect(
        verify({
          ...signed.state,
          referencedPrincipalHeads: signed.state.referencedPrincipalHeads.map(
            (head) =>
              head.principalId === signed.advanced.currentState.principalId
                ? { ...head, stateHash: "0".repeat(64) }
                : head,
          ),
        }),
      ).rejects.toBeInstanceOf(KeyingVerificationError);
      await expect(
        verify({ ...signed.state, containerId: "unbound-root" }),
      ).rejects.toThrow("reserved group grants");
      if (selected) {
        await expect(
          verify(signed.state, {
            ...principalPolicyHead(signed.advancedDirectory),
            stateHash: "0".repeat(64),
          }),
        ).rejects.toThrow("changed organization directory");
        expect(directoryReads()).toBe(initialDirectoryReads);
      }
      const count = f.requests.length;
      state.online = false;
      await expect(verify(signed.state)).rejects.toBeInstanceOf(
        MetadataRootBehindDirectoryError,
      );
      expect(f.requests).toHaveLength(count);
      state.current = false;
      await expect(verify(signed.state)).rejects.toThrow("generation expired");
      expect(f.requests).toHaveLength(count);
      expect(fullReads).toBe(0);
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    } finally {
      f.close();
    }
  },
);
