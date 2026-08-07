import {
  type ContainerNode,
  type DomainScope,
  ORGANIZATION_PROFILE_DOCUMENT_KIND,
  type Tearleads,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useReducer } from "react";
import { useTearleadsExternalStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";

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
  readonly tearleads: Tearleads;
}): string {
  const tree = useMemo(
    () => input.tearleads.deviceFirst.open().containerStore,
    [input.scopeKey, input.tearleads],
  );
  const snapshot = useTearleadsExternalStoreSnapshot(tree);
  const [profileRevision, bumpProfileRevision] = useReducer(
    (revision: number) => revision + 1,
    0,
  );

  useEffect(
    () =>
      input.tearleads.documents.subscribe((document) => {
        if (document.documentKind === ORGANIZATION_PROFILE_DOCUMENT_KIND) {
          bumpProfileRevision();
        }
      }),
    [input.scopeKey, input.tearleads],
  );

  const rootSetKey = useMemo(
    () => organizationRootSetKey(snapshot.nodes),
    [snapshot.nodes],
  );
  return `${rootSetKey}\u0000${profileRevision}`;
}
