import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../adapters/postgres";
import { containers, objectAccessGrants } from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import {
  buildEffectiveRecipientsFromGrantedRecipients,
  CONTAINER_OBJECT_TYPE,
  type ContainerAccessExecutor,
  type DescendantContainerRow,
  type DirectResolvedGrantInputs,
  isAncestorContainerRow,
  isDescendantContainerRow,
  mergeEffectiveRecipients,
  mergeReferencedPrincipalStateArrays,
  type ResolvedContainerInputs,
  type ResolvedContainerRecipients,
  toGrantedRecipientRowsByObjectId,
} from "./containerAccessTypes";
import {
  type AccessGrantRow as ContainerGrantRow,
  type GrantedRecipientWithObjectIdRow,
  PrincipalGrantResolver,
} from "./principalGrantResolver";

async function listAncestorContainerIds(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<string[]> {
  const result = await executor.execute(sql`
    with recursive ancestor_path as (
      select
        c.id,
        c.parent_id,
        array[c.id::text] as visited_ids,
        false as cycle_detected,
        0 as depth
      from ${containers} c
      where c.id = ${containerId}
      union all
      select
        parent.id,
        parent.parent_id,
        ap.visited_ids || parent.id::text,
        parent.id::text = any(ap.visited_ids) as cycle_detected,
        ap.depth + 1
      from ${containers} parent
      inner join ancestor_path ap on parent.id = ap.parent_id
      where not ap.cycle_detected and ap.depth < 100
    )
    select
      id::text as "id",
      cycle_detected as "cycleDetected"
    from ancestor_path
    order by depth desc
  `);

  if (result.rows.length === 0) {
    throw new Error(`Container ${containerId} does not exist`);
  }

  const path: string[] = [];

  for (const row of result.rows) {
    if (!isAncestorContainerRow(row)) {
      throw new Error("Unexpected row shape from ancestor_path CTE");
    }

    if (row.cycleDetected) {
      throw new Error(`Container parent cycle detected at ${row.id}`);
    }

    path.push(row.id);
  }

  return path;
}

async function loadContainerGrantRows(
  containerIds: string[],
  executor: ContainerAccessExecutor = db,
): Promise<ContainerGrantRow[]> {
  if (containerIds.length === 0) {
    return [];
  }

  return executor
    .select({
      objectId: objectAccessGrants.objectId,
      subjectType: objectAccessGrants.subjectType,
      subjectId: objectAccessGrants.subjectId,
      accessLevel: objectAccessGrants.accessLevel,
    })
    .from(objectAccessGrants)
    .where(
      and(
        eq(objectAccessGrants.objectType, CONTAINER_OBJECT_TYPE),
        inArray(objectAccessGrants.objectId, containerIds),
      ),
    );
}

export async function listDescendantContainers(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<DescendantContainerRow[]> {
  const result = await executor.execute(sql`
    with recursive descendants as (
      select
        c.id,
        c.parent_id,
        0 as depth
      from ${containers} c
      where c.id = ${containerId}
      union all
      select
        child.id,
        child.parent_id,
        descendants.depth + 1 as depth
      from ${containers} child
      inner join descendants on child.parent_id = descendants.id
      where descendants.depth < 100
    )
    select
      id::text as "id",
      parent_id::text as "parentId",
      depth as "depth"
    from descendants
    order by depth asc, id asc
  `);

  const descendantContainers: DescendantContainerRow[] = [];

  for (const row of result.rows) {
    if (!isDescendantContainerRow(row)) {
      throw new Error("Unexpected row shape from descendants CTE");
    }

    descendantContainers.push(row);
  }

  return descendantContainers;
}

export async function listDescendantContainerIds(
  containerId: string,
  executor: ContainerAccessExecutor = db,
): Promise<string[]> {
  return (await listDescendantContainers(containerId, executor)).map(
    (container) => container.id,
  );
}

export async function resolveContainerRecipients(
  containerId: string,
  executor: ContainerAccessExecutor = db,
  grantResolver?: PrincipalGrantResolver,
): Promise<ResolvedContainerRecipients> {
  const ancestorContainerIds = await listAncestorContainerIds(
    containerId,
    executor,
  );
  const grants = await loadContainerGrantRows(ancestorContainerIds, executor);
  const resolver = grantResolver ?? new PrincipalGrantResolver(executor);
  const { grantedRecipients, referencedPrincipalsByObjectId } =
    await resolver.resolveGrantEffects(grants);

  return {
    ancestorContainerIds,
    referencedPrincipals: mergeReferencedPrincipalStateArrays(
      ...Array.from(referencedPrincipalsByObjectId.values()),
    ),
    effectiveRecipients:
      buildEffectiveRecipientsFromGrantedRecipients(grantedRecipients),
    cryptoRecipients: await resolver.buildCryptoRecipients(grants),
    grants,
  };
}

function groupContainerGrantsByObjectId(
  grants: ReadonlyArray<ContainerGrantRow>,
) {
  const directGrantsByContainerId = new Map<string, ContainerGrantRow[]>();

  for (const grant of grants) {
    const nextGrants = directGrantsByContainerId.get(grant.objectId) ?? [];
    nextGrants.push(grant);
    directGrantsByContainerId.set(grant.objectId, nextGrants);
  }

  return directGrantsByContainerId;
}

function groupDirectResolvedInputsByObjectId(input: {
  grantedRecipients: ReadonlyArray<GrantedRecipientWithObjectIdRow>;
  referencedPrincipalsByObjectId: Map<
    string,
    ReferencedPrincipalStateResponse[]
  >;
}): Map<string, DirectResolvedGrantInputs> {
  const grantedRecipientsByObjectId = toGrantedRecipientRowsByObjectId(
    input.grantedRecipients,
  );
  const containerIds = uniqueSortedStrings([
    ...Array.from(grantedRecipientsByObjectId.keys()),
    ...Array.from(input.referencedPrincipalsByObjectId.keys()),
  ]);

  return new Map(
    containerIds.map((containerId) => [
      containerId,
      {
        effectiveRecipients: buildEffectiveRecipientsFromGrantedRecipients(
          grantedRecipientsByObjectId.get(containerId) ?? [],
        ),
        referencedPrincipals:
          input.referencedPrincipalsByObjectId.get(containerId) ?? [],
      },
    ]),
  );
}

export function resolveDescendantContainerInputs(
  descendantContainer: DescendantContainerRow,
  rootContainerId: string,
  rootResolvedInputs: ResolvedContainerInputs,
  resolvedInputsByContainerId: Map<string, ResolvedContainerInputs>,
  directGrantsByContainerId: Map<string, ContainerGrantRow[]>,
  directResolvedInputsByContainerId: Map<string, DirectResolvedGrantInputs>,
): ResolvedContainerInputs {
  if (descendantContainer.id === rootContainerId) {
    return rootResolvedInputs;
  }

  const parentId = descendantContainer.parentId;
  if (!parentId) {
    throw new Error(
      `Descendant container ${descendantContainer.id} is missing parent`,
    );
  }

  const parentResolvedInputs = resolvedInputsByContainerId.get(parentId);
  if (!parentResolvedInputs) {
    throw new Error(
      `Parent container ${parentId} was not resolved before child ${descendantContainer.id}`,
    );
  }

  const directResolvedInputs = directResolvedInputsByContainerId.get(
    descendantContainer.id,
  ) ?? {
    effectiveRecipients: [],
    referencedPrincipals: [],
  };

  return {
    ancestorContainerIds: [
      ...parentResolvedInputs.ancestorContainerIds,
      descendantContainer.id,
    ],
    effectiveRecipients: mergeEffectiveRecipients(
      parentResolvedInputs.effectiveRecipients,
      directResolvedInputs.effectiveRecipients,
    ),
    grants: [
      ...parentResolvedInputs.grants,
      ...(directGrantsByContainerId.get(descendantContainer.id) ?? []),
    ],
    referencedPrincipals: mergeReferencedPrincipalStateArrays(
      parentResolvedInputs.referencedPrincipals,
      directResolvedInputs.referencedPrincipals,
    ),
  };
}

export async function prepareRefreshContainerAccessSubtree(input: {
  containerId: string;
  descendantIds: string[];
  executor: ContainerAccessExecutor;
}): Promise<{
  directGrantsByContainerId: Map<string, ContainerGrantRow[]>;
  directResolvedInputsByContainerId: Map<string, DirectResolvedGrantInputs>;
  grantResolver: PrincipalGrantResolver;
  rootResolvedInputs: ResolvedContainerInputs;
}> {
  const directGrants = await loadContainerGrantRows(
    input.descendantIds,
    input.executor,
  );
  const directGrantsByContainerId =
    groupContainerGrantsByObjectId(directGrants);
  const rootAncestorContainerIds = await listAncestorContainerIds(
    input.containerId,
    input.executor,
  );
  const rootAncestorGrants = await loadContainerGrantRows(
    rootAncestorContainerIds,
    input.executor,
  );
  const grantResolver = new PrincipalGrantResolver(input.executor);
  await grantResolver.prime([...rootAncestorGrants, ...directGrants]);
  const directGrantEffects =
    await grantResolver.resolveGrantEffects(directGrants);
  const rootResolvedRecipients = await resolveContainerRecipients(
    input.containerId,
    input.executor,
    grantResolver,
  );

  return {
    directGrantsByContainerId,
    directResolvedInputsByContainerId:
      groupDirectResolvedInputsByObjectId(directGrantEffects),
    grantResolver,
    rootResolvedInputs: {
      ancestorContainerIds: rootResolvedRecipients.ancestorContainerIds,
      effectiveRecipients: rootResolvedRecipients.effectiveRecipients,
      grants: rootResolvedRecipients.grants,
      referencedPrincipals: rootResolvedRecipients.referencedPrincipals,
    },
  };
}
