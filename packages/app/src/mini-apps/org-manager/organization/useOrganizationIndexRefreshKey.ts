import {
  type ContainerNode,
  type DomainScope,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  type SymCrypt,
} from "@symcrypt/client-sdk";
import { useEffect, useMemo, useReducer } from "react";
import { useSymCryptExternalStoreSnapshot } from "../../../providers/sdk/useSymCryptSubscription";

function organizationRootSetKey(nodes: ReadonlyArray<ContainerNode>): string {
  return nodes
    .filter((node) => node.parentId === null)
    .map((node) => `${node.organizationId}:${node.id}`)
    .sort()
    .join("\n");
}

/**
 * Changes when the locally queryable organization index may have changed.
 *
 * Root-tree changes cover organization presence even when no profile exists or
 * can be decrypted. Profile-document persistence is a separate signal because
 * its body can finish pulling after the container tree has already settled.
 */
export function useOrganizationIndexRefreshKey(input: {
  readonly scopeKey: DomainScope;
  readonly symcrypt: SymCrypt;
}): string {
  const tree = useMemo(
    () => input.symcrypt.deviceFirst.open().containerStore,
    [input.scopeKey, input.symcrypt],
  );
  const snapshot = useSymCryptExternalStoreSnapshot(tree);
  const [profileRevision, bumpProfileRevision] = useReducer(
    (revision: number) => revision + 1,
    0,
  );

  useEffect(
    () =>
      input.symcrypt.documents.subscribe((document) => {
        if (document.documentKind === ORGANIZATION_PROFILE_DOCUMENT_KIND) {
          bumpProfileRevision();
        }
      }),
    [input.scopeKey, input.symcrypt],
  );

  const rootSetKey = useMemo(
    () => organizationRootSetKey(snapshot.nodes),
    [snapshot.nodes],
  );
  return `${rootSetKey}\u0000${profileRevision}`;
}
