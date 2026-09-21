import { expect, test } from "bun:test";
import { createEncryptedColdDocument } from "../../../test/helpers/coldSdkRematerialization";
import { createLeafWriterAncestorEdit } from "../../../test/helpers/leafWriterAncestorEdit";
import {
  createOwnedTree,
  isPathCurrent,
} from "../../../test/helpers/ownedContainerTree";
import { routeApp } from "../../routeApp";

// #2340 finding 1, continued from `documents/inaccessibleIntermediateRepair`:
// every rotation source, the share precondition, and the shape of the owed set.

// With nothing granted beneath it a chain may sit lazily stale, and the API
// refuses a first grant below one (`grantBelowStaleChain.test.ts`). The sharer
// can re-key every such level, so the SDK does that before it grants.

test("sharing below a lazily stale chain repairs the path first", async () => {
  const tree = await createOwnedTree(1);
  const [writer] = tree.members;
  if (!writer) throw new Error("Expected a writer");
  try {
    const upper = await tree.createChild(tree.rootId);
    const lower = await tree.createChild(upper);
    const created = await createEncryptedColdDocument({
      containerId: lower,
      organizationId: tree.organizationId,
      owner: tree.owner,
    });
    // Nothing is granted below the root, so it rotates alone and carries
    // nothing; `upper` and `lower` are left lazily stale.
    expect(await tree.rotateRoot()).toEqual([]);
    expect(isPathCurrent(await tree.keksOf(lower))).toBe(false);

    await tree.share(lower, writer.userId);
    expect(isPathCurrent(await tree.keksOf(lower))).toBe(true);

    const edit = await createLeafWriterAncestorEdit({
      documentId: created.documentId,
      organizationId: tree.organizationId,
      owner: tree.owner,
      writer,
    });
    try {
      const written = await edit.attemptWrite();
      expect(written?.settledPendingUpdateIds).toContain(edit.updateId);
      expect(edit.abandoned).toEqual([]);
      expect(edit.standaloneRepairs).toEqual([]);
    } finally {
      edit.close();
    }
  } finally {
    tree.close();
  }
}, 180_000);

test("a revoke carries the levels above a granted container", async () => {
  const tree = await createOwnedTree(2);
  const [writer, revoked] = tree.members;
  if (!writer || !revoked) throw new Error("Expected two members");
  try {
    const upper = await tree.createChild(tree.rootId);
    const lower = await tree.createChild(upper);
    await tree.share(lower, writer.userId);
    await tree.share(tree.rootId, revoked.userId);

    expect(await tree.revokeFromRoot(revoked.userId)).toEqual([upper]);
    expect(isPathCurrent((await tree.keksOf(lower)).slice(0, -1))).toBe(true);
  } finally {
    tree.close();
  }
}, 180_000);

// A move re-parents as well as rotates, so the carried rekeys are signed
// against the destination path, not the one the descendants are served under.

test("a move carries the levels above a granted container onto the new path", async () => {
  const tree = await createOwnedTree(1);
  const [writer] = tree.members;
  if (!writer) throw new Error("Expected a writer");
  try {
    const source = await tree.createChild(tree.rootId);
    const destination = await tree.createChild(tree.rootId);
    const moved = await tree.createChild(source);
    const upper = await tree.createChild(moved);
    const lower = await tree.createChild(upper);
    await tree.share(lower, writer.userId);

    expect(await tree.move(moved, destination)).toEqual([upper]);
    const keks = await tree.keksOf(lower);
    expect(keks.map((kek) => kek.containerId)).toEqual([
      tree.rootId,
      destination,
      moved,
      upper,
      lower,
    ]);
    expect(isPathCurrent(keks.slice(0, -1))).toBe(true);
  } finally {
    tree.close();
  }
}, 180_000);

// The owed set comes from walking up from the organization's granted
// containers. Grants on two branches owe the union of their chains once each,
// parent-first; a granted container directly below the rotated one owes
// nothing; and another organization's grants are never in scope.

test("the owed set is the union of granted chains within the organization", async () => {
  const tree = await createOwnedTree(2);
  const other = await createOwnedTree(1);
  const [first, second] = tree.members;
  const [outsider] = other.members;
  if (!first || !second || !outsider) throw new Error("Expected members");
  try {
    const shared = await tree.createChild(tree.rootId);
    const leftLeaf = await tree.createChild(shared);
    const rightBranch = await tree.createChild(shared);
    const rightLeaf = await tree.createChild(rightBranch);
    // Directly below the root: nothing sits between it and the rotation.
    const adjacent = await tree.createChild(tree.rootId);
    await tree.share(leftLeaf, first.userId);
    await tree.share(rightLeaf, second.userId);
    await tree.share(adjacent, first.userId);

    // A deeper granted chain in another organization.
    const foreignUpper = await other.createChild(other.rootId);
    const foreignLower = await other.createChild(foreignUpper);
    await other.share(foreignLower, outsider.userId);

    const refused = await routeApp.request(`/containers/${tree.rootId}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tree.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(await tree.bareRootRekeyRequest()),
    });
    expect(refused.status).toBe(409);
    const body: unknown = await refused.json();
    // `shared` is owed once though two grants sit below it, and comes first.
    expect(Reflect.get(Object(body), "requiredContainerIds")).toEqual([
      shared,
      rightBranch,
    ]);

    expect(await tree.rotateRoot()).toEqual([shared, rightBranch]);
    for (const leaf of [leftLeaf, rightLeaf]) {
      expect(isPathCurrent((await tree.keksOf(leaf)).slice(0, -1))).toBe(true);
    }
    // The other organization's tree was neither owed nor touched.
    expect(isPathCurrent(await other.keksOf(foreignLower))).toBe(true);
  } finally {
    tree.close();
    other.close();
  }
}, 240_000);
