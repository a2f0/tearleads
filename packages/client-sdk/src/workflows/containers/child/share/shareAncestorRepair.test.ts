import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createRotatedAncestorFixture } from "../../../../../test/helpers/ancestorRotationRecovery";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/containerMutationServiceFixture";
import { createContainerServer } from "../../../../../test/helpers/data/containerMutationServer";
import { createTestTrustedUserIdentity } from "../../../../../test/helpers/data/trustedUserIdentity";
import { assertContainerKekPathCurrent } from "../../../../data/documents/shared/containerKek/containerKekCurrency";

// #2340 finding 1. With nothing shared beneath it, a chain may sit lazily stale
// after an ancestor rotation: nobody's writes depend on it. The first grant
// below it changes that, because its grantee could never re-key those levels.
// So the sharer, who can, re-keys the chain before granting.

test("sharing below a lazily stale chain repairs it first", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("share-ancestor-repair");
  try {
    const owner = {
      ...fixture.input,
      execSql: database.execSql,
      persistVerificationCheckpoints: undefined,
    };
    const rootId = fixture.root.projection.containerId;
    // Nothing below the root is granted yet, so the rotation carries nothing.
    const server = createContainerServer([
      fixture.root.projection,
      fixture.child.projection,
      fixture.grandchild.projection,
    ]);
    expect(
      await createContainerMutationServiceFixture({
        api: server.apiClient,
        encapsulationSecretKey: owner.targetSecretKey,
        execSql: owner.execSql,
        reportSecurityIncident: async () => {},
      }).rekeyRemoteContainer({
        author: owner.author,
        containerId: rootId,
        resolveProjectionUserKey: owner.resolveProjectionUserKey,
      }),
    ).not.toBeNull();
    const stale = server.project("grandchild");
    if (!stale) throw new Error("Expected the grandchild projection");
    expect(() => assertContainerKekPathCurrent(stale.containerKeks)).toThrow();

    const recipientKem = generateKemSeedAndKeyPair();
    const recipientSigning = generateSigningSeedAndKeyPair();
    const shared = await createContainerMutationServiceFixture({
      api: server.apiClient,
      encapsulationSecretKey: owner.targetSecretKey,
      execSql: owner.execSql,
      reportSecurityIncident: async () => {},
      resolveTrustedUserIdentity: async (userId) =>
        createTestTrustedUserIdentity({
          userId,
          encapsulationPublicKey: recipientKem.publicKey,
          signingPublicKey: recipientSigning.signingPublicKey,
          signingKeyFingerprint: "leaf-writer-signing-key",
        }),
    }).shareRemoteContainer({
      accessLevel: "write",
      author: owner.author,
      containerId: "grandchild",
      recipientUserId: "leaf-writer",
      resolveProjectionUserKey: owner.resolveProjectionUserKey,
    });
    expect(shared).not.toBeNull();
    // The path was re-keyed parent-first, the container included, and only
    // then was the grant submitted: a grant cites the parent's current epoch,
    // which the container's own key epoch has to pin.
    expect(server.submissions).toEqual([
      [rootId],
      ["child"],
      ["grandchild"],
      ["share:grandchild"],
    ]);
    const granted = server.project("grandchild");
    if (!granted) throw new Error("Expected the grandchild projection");
    expect(() =>
      assertContainerKekPathCurrent(granted.containerKeks),
    ).not.toThrow();
  } finally {
    database.close();
  }
}, 120_000);
