import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestDocumentLinkProjection,
  accessManifestPrincipalHeadProjection,
  type accessManifests,
} from "@tearleads/api-shared/schema";
import type {
  AnyVerifiedAccessManifest,
  ContainerAccessManifestState,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  containerManifestState,
  documentLinkSetState,
  isContainerDirectGrant,
  isReferencedPrincipalHead,
  readJsonArray,
} from "./accessManifestJson";

/**
 * Derived projection rows for an access manifest. They are cache only: every
 * reader verifies the signed manifest before trusting a projected row.
 */

export async function regenerateAccessManifestPrincipalProjection(
  manifest: typeof accessManifests.$inferSelect,
  executor: DatabaseSession,
): Promise<void> {
  await executor
    .delete(accessManifestPrincipalHeadProjection)
    .where(
      eq(
        accessManifestPrincipalHeadProjection.manifestHash,
        manifest.manifestHash,
      ),
    );
  await insertAccessManifestPrincipalProjection(manifest, executor);
}

export async function insertAccessManifestPrincipalProjection(
  manifest: typeof accessManifests.$inferSelect,
  executor: DatabaseSession,
): Promise<void> {
  const referencedPrincipalHeads = readJsonArray<ReferencedPrincipalHead>(
    manifest.referencedPrincipalHeads,
    "access manifest principal projection source",
    isReferencedPrincipalHead,
  );

  if (referencedPrincipalHeads.length === 0) {
    return;
  }
  // Document manifests always commit to an empty head list, so document purge
  // never deletes projection rows by document; refuse a row it would orphan.
  if (manifest.objectKind === "document") {
    throw new Error(
      "Document access manifests cannot reference principal heads",
    );
  }

  await executor.insert(accessManifestPrincipalHeadProjection).values(
    referencedPrincipalHeads.map((principalHead) => ({
      manifestHash: manifest.manifestHash,
      objectKind: manifest.objectKind,
      objectId: manifest.objectId,
      principalType: principalHead.principalType,
      principalId: principalHead.principalId,
      version: principalHead.version,
      keyEpoch: principalHead.keyEpoch,
      stateHash: principalHead.stateHash,
      keyFingerprint: principalHead.keyFingerprint,
    })),
  );
}

export async function regenerateAccessManifestContainerGrantProjection(
  manifest: typeof accessManifests.$inferSelect,
  executor: DatabaseSession,
): Promise<void> {
  await executor
    .delete(accessManifestContainerGrantProjection)
    .where(
      eq(
        accessManifestContainerGrantProjection.manifestHash,
        manifest.manifestHash,
      ),
    );

  if (manifest.objectKind !== "container") {
    return;
  }

  const state =
    typeof manifest.state === "object" && manifest.state !== null
      ? manifest.state
      : {};
  const directGrantValue = Reflect.get(state, "directGrants");
  if (directGrantValue === undefined) {
    return;
  }
  const directGrants = readJsonArray<
    ContainerAccessManifestState["directGrants"][number]
  >(
    directGrantValue,
    "access manifest container grant projection source",
    isContainerDirectGrant,
  );

  if (directGrants.length === 0) {
    return;
  }

  await executor.insert(accessManifestContainerGrantProjection).values(
    directGrants.map((grant) => ({
      manifestHash: manifest.manifestHash,
      containerId: manifest.objectId,
      accessLevel: grant.accessLevel,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
    })),
  );
}

export async function replaceAccessManifestDocumentLinkProjection(
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: DatabaseSession,
  freshManifest: boolean,
): Promise<void> {
  const state = documentLinkSetState(verifiedManifest);
  if (!state) {
    return;
  }

  if (!freshManifest) {
    await executor
      .delete(accessManifestDocumentLinkProjection)
      .where(
        eq(
          accessManifestDocumentLinkProjection.manifestHash,
          verifiedManifest.manifestHash,
        ),
      );
  }

  if (state.linkedContainerIds.length === 0) {
    return;
  }

  await executor.insert(accessManifestDocumentLinkProjection).values(
    state.linkedContainerIds.map((containerId) => ({
      manifestHash: verifiedManifest.manifestHash,
      documentId: state.documentId,
      containerId,
    })),
  );
}

export async function replaceAccessManifestContainerGrantProjection(
  verifiedManifest: AnyVerifiedAccessManifest,
  executor: DatabaseSession,
  freshManifest: boolean,
): Promise<void> {
  const state = containerManifestState(verifiedManifest);
  if (!state) {
    return;
  }

  if (!freshManifest) {
    await executor
      .delete(accessManifestContainerGrantProjection)
      .where(
        eq(
          accessManifestContainerGrantProjection.manifestHash,
          verifiedManifest.manifestHash,
        ),
      );
  }

  if (state.directGrants.length === 0) {
    return;
  }

  await executor.insert(accessManifestContainerGrantProjection).values(
    state.directGrants.map((grant) => ({
      manifestHash: verifiedManifest.manifestHash,
      containerId: state.containerId,
      accessLevel: grant.accessLevel,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
    })),
  );
}
