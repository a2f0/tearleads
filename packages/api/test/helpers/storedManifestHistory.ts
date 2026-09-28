import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  ContainerAccessEventBody,
  ContainerDirectGrant,
  KeyingCanonicalJson,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import {
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
} from "@tearleads/crypto/test-fixtures";
import { bytesToBase64 } from "@tearleads/encoding";
import { toManifestBundleResponse } from "../../src/workflows/containers/writerProjection/records";

export async function signedContainerHistory(length: number) {
  const signer = generateSigningSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const admin: ContainerDirectGrant = {
    subjectType: "user",
    subjectId: signerUserId,
    accessLevel: "admin",
  };
  const manifests: VerifiedContainerAccessManifest[] = [
    await createContainerManifestFixture({
      containerId,
      containerKeyEpochId: crypto.randomUUID(),
      directGrants: [admin],
      signer,
      signerUserId,
    }),
  ];
  const recipientId = crypto.randomUUID();
  for (let epoch = 2; epoch <= length; epoch += 1) {
    const previous = manifests.at(-1);
    if (!previous) throw new Error("Missing history predecessor");
    const grant: ContainerDirectGrant = {
      subjectType: "user",
      subjectId: recipientId,
      accessLevel: epoch % 2 === 0 ? "read" : "write",
    };
    const body: ContainerAccessEventBody = {
      eventType: "container.grant",
      containerKeyEpochId: previous.state.containerKeyEpochId,
      containerKeyPublicKey: previous.state.containerKeyPublicKey,
      grant,
      referencedPrincipalHead: null,
    };
    const event = await createVerifiedContainerAccessEvent({
      body,
      objectId: containerId,
      organizationId: previous.state.organizationId,
      previousManifestHash: previous.manifestHash,
      dependencyManifestHashes: [previous.manifestHash],
      signer,
      signerUserId,
    });
    manifests.push(
      await createContainerManifestFixture({
        containerId,
        containerKeyEpochId: previous.state.containerKeyEpochId,
        containerKeyPublicKey: previous.state.containerKeyPublicKey,
        directGrants: [admin, grant].sort((left, right) =>
          left.subjectId < right.subjectId ? -1 : 1,
        ),
        epoch,
        event,
        signer,
        signerUserId,
        previousManifestHash: previous.manifestHash,
      }),
    );
  }
  const user = {
    fingerprint: await toFingerprint(signer.signingPublicKey),
    signingPublicKey: bytesToBase64(signer.signingPublicKey),
  };
  // This graph fixture isolates stored verification; its only query loads the
  // signer's real key. No group-policy references require additional queries.
  const executor = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [user] }) }),
    }),
  } as unknown as DatabaseSession;
  const bundles = manifests.map((manifest) =>
    toManifestBundleResponse({
      ...manifest,
      state: manifest.state as unknown as KeyingCanonicalJson,
    }),
  );
  const byHash = new Map(
    bundles.map((bundle) => [bundle.manifestHash, bundle]),
  );
  const loadBundle = async (hash: string) => {
    const bundle = byHash.get(hash);
    if (!bundle) throw new Error("Missing history dependency");
    return bundle;
  };
  return { bundles, executor, loadBundle, manifests };
}
