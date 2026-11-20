import { createHmac } from "node:crypto";
import { loadFolderTree } from "./folderTree";
import type { CliSession } from "./session";

export function seedLocalId(
  signingPrivateKey: Uint8Array,
  rootId: string,
  datasetSha256: string,
  key: string,
) {
  return createHmac("sha256", signingPrivateKey)
    .update(`tearleads.continuity/${rootId}/${datasetSha256}/${key}`)
    .digest("hex");
}

export async function resolveSeedAccount(
  session: CliSession,
  organizationId: string | undefined,
) {
  const { sdk } = session;
  if (
    organizationId !== undefined &&
    organizationId !== sdk.session.defaultOrganizationId
  ) {
    throw new Error(
      "Seed requires the signed-in account's personal organization.",
    );
  }
  const { memberships, nodes } = await loadFolderTree(session);
  const org = memberships.find((m) => m.isPersonalOrganizationOwner);
  if (!org || org.organizationId !== sdk.session.organizationId) {
    throw new Error(
      "Seed requires the signed-in account's personal organization.",
    );
  }
  const rootId = sdk.runtime.input().auth.rootContainerId;
  const root = nodes.find(
    (node) =>
      node.id === rootId &&
      node.organizationId === org.organizationId &&
      node.parentId === null,
  );
  const keys = sdk.identity.signingKeyPair;
  if (!root || !keys)
    throw new Error(
      "Could not resolve the account's root and signing identity.",
    );
  return {
    rootId: root.id,
    signingPrivateKey: keys.signingPrivateKey,
    folders: nodes
      .filter((node) => node.organizationId === org.organizationId)
      .map((node) => node.id),
  };
}
