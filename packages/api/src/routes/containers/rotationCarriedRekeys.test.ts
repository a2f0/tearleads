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

// A carried rekey rides the rotation above it, so it must sit below one. An
// ancestor does not: rotating `lower` and then, in the same batch, its parent
// `upper` would leave `lower` pinned to a retired epoch with a grant beneath
// it. Nor does the rotated container itself.

test("carrying an ancestor's rekey is refused as not below the rotation", async () => {
  const tree = await createOwnedTree(1);
  const [writer] = tree.members;
  if (!writer) throw new Error("Expected a writer");
  try {
    const upper = await tree.createChild(tree.rootId);
    const lower = await tree.createChild(upper);
    const granted = await tree.createChild(lower);
    await tree.share(granted, writer.userId);
    const before = await tree.keksOf(granted);

    const refused = await routeApp.request(`/containers/${lower}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tree.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(await tree.bareRekeyRequest(lower)),
        containerRekeys: [await tree.bareRekeyRequest(upper)],
      }),
    });
    expect(refused.status, (await refused.clone().text()).slice(0, 300)).toBe(
      409,
    );
    expect(await refused.json()).toMatchObject({
      error: "Carried container rekey is not below the rotated container",
    });
    // Refused whole: neither rotation landed.
    expect(await tree.keksOf(granted)).toEqual(before);

    const selfCarried = await routeApp.request(`/containers/${lower}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tree.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(await tree.bareRekeyRequest(lower)),
        containerRekeys: [await tree.bareRekeyRequest(lower)],
      }),
    });
    expect(selfCarried.status).toBe(409);
    expect(await selfCarried.json()).toMatchObject({
      error: "Carried container rekey is not below the rotated container",
    });
    expect(await tree.keksOf(granted)).toEqual(before);
  } finally {
    tree.close();
  }
}, 180_000);

// Create and share validate with the loose mutation schema, which keeps unknown
// keys, so `containerRekeys` reaches the workflow unvalidated on those routes.

test("only a rotation may carry rekeys, and only as a list", async () => {
  const tree = await createOwnedTree(0);
  try {
    const child = await tree.createChild(tree.rootId);
    const request = await tree.bareRekeyRequest(child);
    const share = (containerRekeys: unknown) =>
      routeApp.request(`/containers/${child}/share`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tree.owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...request, containerRekeys }),
      });
    const carried = await share([request]);
    expect(carried.status).toBe(400);
    expect(await carried.json()).toMatchObject({
      error: "Only a rotation may carry container rekeys",
    });
    for (const malformed of [5, {}, "rekeys"]) {
      const response = await share(malformed);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "Container rekeys must be a list",
      });
    }
  } finally {
    tree.close();
  }
}, 120_000);

// A container in another organization is never below this one's rotation, so
// it cannot ride it. The per-organization currency walk behind that check
// stays as defence in depth: a batch locks whatever organizations it names.

test("a carried rekey in another organization is refused as not below the rotation", async () => {
  const home = await createOwnedTree(0);
  const away = await createOwnedTree(1, [home.owner]);
  const outsider = away.members.find((member) => member !== home.owner);
  if (!outsider) throw new Error("Expected an outsider");
  try {
    const upper = await away.createChild(away.rootId);
    const lower = await away.createChild(await away.createChild(upper));
    // The home owner may write, and so rekey, from `upper` down.
    await away.share(upper, home.owner.userId);
    await away.share(lower, outsider.userId);
    const before = await away.keksOf(lower);

    const refused = await routeApp.request(`/containers/${home.rootId}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${home.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(await home.bareRootRekeyRequest()),
        containerRekeys: [await away.bareRekeyRequestAs(home.owner, upper)],
      }),
    });
    expect(refused.status, (await refused.clone().text()).slice(0, 300)).toBe(
      409,
    );
    expect(await refused.json()).toMatchObject({
      error: "Carried container rekey is not below the rotated container",
    });
    expect(await away.keksOf(lower)).toEqual(before);
  } finally {
    home.close();
    away.close();
  }
}, 240_000);

// The walk starts from every grant in the organization, so one on an unrelated
// branch is looked at and must then owe nothing: only chains that reach the
// rotated container count.

test("a grant on an unrelated branch owes a rotation nothing", async () => {
  const tree = await createOwnedTree(1);
  const [writer] = tree.members;
  if (!writer) throw new Error("Expected a writer");
  try {
    const left = await tree.createChild(tree.rootId);
    const leftUpper = await tree.createChild(left);
    const leftLower = await tree.createChild(leftUpper);
    const right = await tree.createChild(tree.rootId);
    const rightUpper = await tree.createChild(right);
    const rightLower = await tree.createChild(rightUpper);
    await tree.share(leftLower, writer.userId);
    await tree.share(rightLower, writer.userId);

    const refused = await routeApp.request(`/containers/${left}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tree.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(await tree.bareRekeyRequest(left)),
    });
    expect(refused.status).toBe(409);
    // Only the left chain; nothing under `right` is owed or named.
    expect(await refused.json()).toMatchObject({
      requiredContainerIds: [leftUpper],
    });

    // Nor may the rotation carry a rekey from that branch: a sibling's
    // descendant is not below `left`, however much it shares.
    const sibling = await routeApp.request(`/containers/${left}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tree.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(await tree.bareRekeyRequest(left)),
        containerRekeys: [await tree.bareRekeyRequest(rightUpper)],
      }),
    });
    expect(sibling.status).toBe(409);
    expect(await sibling.json()).toMatchObject({
      error: "Carried container rekey is not below the rotated container",
    });
  } finally {
    tree.close();
  }
}, 180_000);
