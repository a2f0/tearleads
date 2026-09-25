import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { fixtureContainerKekMaterialId } from "./containerKekMaterial.testFixtures";
import {
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createVerifiedDocumentAccessEvent,
} from "./testFixtures";
import type {
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
} from "./types";

export async function citationScopeFixture() {
  const signer = generateSigningSeedAndKeyPair();
  const signerUserId = "writer";
  const organizationId = "organization";
  const container = async (containerId: string, org = organizationId) =>
    createContainerManifestFixture({
      containerId,
      containerKeyEpochId: await fixtureContainerKekMaterialId(
        containerId,
        containerId,
      ),
      directGrants: [
        { subjectType: "user", subjectId: signerUserId, accessLevel: "write" },
      ],
      organizationId: org,
      signer,
      signerUserId,
    });
  const first = await container("first");
  const second = await container("second");
  const unrelated = await container("unrelated");
  const foreign = await container("foreign", "another-organization");
  const transition = async (
    eventType: "document.link" | "document.unlink",
    target: VerifiedContainerAccessManifest,
    previous: VerifiedDocumentLinkSetManifest | null,
    paths: readonly (readonly VerifiedContainerAccessManifest[])[],
  ) => {
    const linkedContainerIds = previous?.state.linkedContainerIds ?? [];
    const event = await createVerifiedDocumentAccessEvent({
      body: {
        eventType,
        containerId: target.state.containerId,
        containerManifestHash: target.manifestHash,
        blobRewraps: [],
      },
      dependencyManifestHashes: [
        ...new Set([
          target.manifestHash,
          ...paths.flat().map((head) => head.manifestHash),
        ]),
      ],
      objectId: "document",
      organizationId,
      previousManifestHash: previous?.manifestHash ?? null,
      signer,
      signerUserId,
    });
    return createDocumentLinkSetManifestFixture({
      documentId: "document",
      epoch: (previous?.state.epoch ?? 0) + 1,
      event,
      linkedContainerIds:
        eventType === "document.link"
          ? [...linkedContainerIds, target.state.containerId]
          : linkedContainerIds.filter((id) => id !== target.state.containerId),
      organizationId,
      previousManifestHash: previous?.manifestHash ?? null,
    });
  };
  const document = await transition("document.link", first, null, []);
  return {
    signer,
    signerUserId,
    organizationId,
    first,
    second,
    unrelated,
    foreign,
    document,
    transition,
  };
}
