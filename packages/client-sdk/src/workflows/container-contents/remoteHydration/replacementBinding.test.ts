import { expect, test } from "bun:test";
import {
  generateSigningSeedAndKeyPair,
  organizationReplacementSigningBytes,
  sign,
  signOrganizationReplacementAuthorization,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createMockRequestFailure,
  createNativeTestExecSql,
} from "@tearleads/test-utils";
import { sharedReplacementBindingFixture } from "../../../../test/helpers/sharedReplacementBinding";
import {
  loadOrganizationFounder,
  rememberOrganizationFounder,
} from "../../../data/persistence/organizationFounderPersistence";
import { buildOrganizationProvisioningArtifacts } from "../../registration/registerIdentity";
import { assertPermittedDestinationBinding } from "./replacementBinding";

test("a re-shared member accepts only the held founder's signed replacement", async () => {
  const database = createNativeTestExecSql();
  try {
    const { input, proof, signingKeyPair } =
      await sharedReplacementBindingFixture(database.execSql);
    await expect(
      assertPermittedDestinationBinding(input),
    ).resolves.toBeUndefined();
    // Recreating the runtime cannot forget the SQLite authority binding.
    await expect(
      assertPermittedDestinationBinding({
        ...input,
        runtime: { ...input.runtime },
      }),
    ).resolves.toBeUndefined();
    const signedChanged = (change: Partial<typeof proof>) => {
      const changed = { ...proof, ...change };
      return {
        ...changed,
        signature: bytesToBase64(
          sign(
            organizationReplacementSigningBytes(changed),
            signingKeyPair.signingPrivateKey,
          ),
        ),
      };
    };
    for (const candidate of [
      { ...proof, organizationId: crypto.randomUUID() },
      {
        ...proof,
        signature: bytesToBase64(
          sign(
            organizationReplacementSigningBytes(proof),
            generateSigningSeedAndKeyPair().signingPrivateKey,
          ),
        ),
      },
      signedChanged({ replacesOrganizationId: crypto.randomUUID() }),
      signedChanged({ rootManifestHash: "a".repeat(64) }),
      signedChanged({ organizationStateHash: "b".repeat(64) }),
      signedChanged({ userId: "different-owner" }),
    ]) {
      input.runtime.apiClient.getContainerReplacementAuthorizationsResult =
        async () => ({ ok: true, data: { authorizations: [candidate] } });
      await expect(assertPermittedDestinationBinding(input)).rejects.toThrow();
    }
    input.runtime.apiClient.getContainerReplacementAuthorizationsResult =
      async () =>
        createMockRequestFailure({ status: 404, message: "Missing proof" });
    await expect(
      assertPermittedDestinationBinding(input),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    database.close();
  }
});

test("organization founder pins cannot be substituted or borrowed from another organization", async () => {
  const database = createNativeTestExecSql();
  try {
    const { input, policies } = await sharedReplacementBindingFixture(
      database.execSql,
    );
    const organizationId = input.heldBinding?.organizationId;
    if (!organizationId || !policies[0])
      throw new Error("Expected held organization");
    const founder = await loadOrganizationFounder(
      database.execSql,
      organizationId,
    );
    expect(founder?.userId).toBe(input.role.createSignerUserId);
    const foreign = await sharedReplacementBindingFixture(database.execSql);
    const foreignPolicy = foreign.policies[0];
    if (!foreignPolicy) throw new Error("Expected foreign policy");
    // A separate valid organization does not authorize this held binding.
    await expect(
      assertPermittedDestinationBinding({
        ...input,
        role: {
          ...input.role,
          createSignerUserId: foreign.input.role.createSignerUserId,
        },
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    await rememberOrganizationFounder({
      execSql: database.execSql,
      organization: policies[0],
    });
    expect(
      await loadOrganizationFounder(database.execSql, organizationId),
    ).toEqual(founder);
  } finally {
    database.close();
  }
});

test("an unavailable founder identity retries without alleging a signer mismatch", async () => {
  const database = createNativeTestExecSql();
  try {
    const { input } = await sharedReplacementBindingFixture(database.execSql);
    await expect(
      assertPermittedDestinationBinding({
        ...input,
        runtime: {
          ...input.runtime,
          resolveTrustedUserIdentity: async () => null,
        },
      }),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
  } finally {
    database.close();
  }
});

test("a member can follow multiple replacements but cannot skip or replay a link", async () => {
  const database = createNativeTestExecSql();
  try {
    const data = await sharedReplacementBindingFixture(database.execSql);
    const rootContainerId = crypto.randomUUID();
    const middle = await buildOrganizationProvisioningArtifacts({
      signingKeyPair: data.signingKeyPair,
      encapsulationKeyPair: data.encapsulationKeyPair,
      userId: data.userId,
      rootContainerId,
    });
    const first = await signOrganizationReplacementAuthorization(
      {
        ...middle,
        rootContainerId,
        userId: data.userId,
        replacesOrganizationId: data.proof.replacesOrganizationId,
      },
      data.signingKeyPair,
    );
    const second = await signOrganizationReplacementAuthorization(
      {
        ...data.replacement,
        rootContainerId: data.rootContainerId,
        userId: data.userId,
        replacesOrganizationId: middle.organizationId,
      },
      data.signingKeyPair,
    );
    data.input.runtime.apiClient.getContainerReplacementAuthorizationsResult =
      async () => ({ ok: true, data: { authorizations: [first, second] } });
    await expect(
      assertPermittedDestinationBinding(data.input),
    ).resolves.toBeUndefined();
    for (const authorizations of [
      [second],
      [first, first, second],
      [second, first],
    ]) {
      data.input.runtime.apiClient.getContainerReplacementAuthorizationsResult =
        async () => ({ ok: true, data: { authorizations } });
      await expect(
        assertPermittedDestinationBinding(data.input),
      ).rejects.toMatchObject({ code: "object_mismatch" });
    }
  } finally {
    database.close();
  }
});
