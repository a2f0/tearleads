import type { VfsAclAccessLevel, VfsAclPrincipalType } from '@tearleads/shared';
import type { ActorHarness } from './actorHarness.js';
import type { ServerHarness } from './serverHarness.js';

export interface AssertServerHasAclEntryInput {
  server: ServerHarness;
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
}

export function assertServerHasAclEntry(
  input: AssertServerHasAclEntryInput
): void {
  const snapshot = input.server.snapshot();
  const match = snapshot.acl.find(
    (entry) =>
      entry.itemId === input.itemId &&
      entry.principalType === input.principalType &&
      entry.principalId === input.principalId &&
      entry.accessLevel === input.accessLevel
  );
  if (!match) {
    throw new Error(
      `Expected server ACL to contain entry: ` +
        `itemId=${input.itemId}, principalType=${input.principalType}, ` +
        `principalId=${input.principalId}, accessLevel=${input.accessLevel}. ` +
        `Actual ACL: ${JSON.stringify(snapshot.acl)}`
    );
  }
}

export interface AssertServerHasLinkInput {
  server: ServerHarness;
  parentId: string;
  childId: string;
}

export function assertServerHasLink(input: AssertServerHasLinkInput): void {
  const snapshot = input.server.snapshot();
  const match = snapshot.links.find(
    (link) =>
      link.parentId === input.parentId && link.childId === input.childId
  );
  if (!match) {
    throw new Error(
      `Expected server to have link: parentId=${input.parentId}, ` +
        `childId=${input.childId}. Actual links: ${JSON.stringify(snapshot.links)}`
    );
  }
}

export interface AssertServerFeedLengthInput {
  server: ServerHarness;
  expected: number;
}

export function assertServerFeedLength(
  input: AssertServerFeedLengthInput
): void {
  const snapshot = input.server.snapshot();
  if (snapshot.feed.length !== input.expected) {
    throw new Error(
      `Expected server feed length ${input.expected}, got ${snapshot.feed.length}`
    );
  }
}

export interface AssertLocalVfsRegistryHasInput {
  actor: ActorHarness;
  itemId: string;
}

export function assertLocalVfsRegistryHas(
  input: AssertLocalVfsRegistryHasInput
): void {
  const snapshot = input.actor.syncSnapshot();
  const hasAcl = snapshot.acl.some(
    (entry) => entry.itemId === input.itemId
  );
  const hasLink =
    snapshot.links.some(
      (link) =>
        link.parentId === input.itemId || link.childId === input.itemId
    );

  if (!hasAcl && !hasLink) {
    throw new Error(
      `Expected actor "${input.actor.alias}" to have item ${input.itemId} ` +
        `in local VFS registry (acl or links). ` +
        `ACL: ${JSON.stringify(snapshot.acl)}, Links: ${JSON.stringify(snapshot.links)}`
    );
  }
}

export function assertActorFeedReplayHas(
  actor: ActorHarness,
  itemId: string
): void {
  const snapshot = actor.syncSnapshot();
  const hasAcl = snapshot.acl.some(
    (entry) => entry.itemId === itemId
  );
  const hasLink = snapshot.links.some(
    (link) => link.parentId === itemId || link.childId === itemId
  );

  if (!hasAcl && !hasLink) {
    throw new Error(
      `Expected actor "${actor.alias}" feed replay to contain item ${itemId}. ` +
        `ACL: ${JSON.stringify(snapshot.acl)}, Links: ${JSON.stringify(snapshot.links)}`
    );
  }
}
