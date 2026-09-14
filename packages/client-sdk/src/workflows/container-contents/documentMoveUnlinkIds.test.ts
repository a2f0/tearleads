import { expect, test } from "bun:test";
import { resolveContainerDocumentMoveUnlinkIds } from "./documentMoveUnlinkIds";

// #2278 #4: the unlink set is governed by the verified manifest's link set
// alone. A source the manifest no longer lists (an honest server removed the
// link when the container went away) drops out; a source it still lists is
// always attempted, so no server-asserted "container gone" can skip a revoke.
test("a replacing move unlinks every manifest-listed source except the target", () => {
  expect(
    resolveContainerDocumentMoveUnlinkIds({
      currentContainerId: "root",
      linkedContainerIds: ["extra", "root", "trash"],
      replaceLinkedContainers: true,
      targetContainerId: "trash",
    }),
  ).toEqual(["extra", "root"]);
});

test("a source the verified manifest no longer links is not unlinked", () => {
  expect(
    resolveContainerDocumentMoveUnlinkIds({
      currentContainerId: "root",
      linkedContainerIds: ["trash"],
      replaceLinkedContainers: true,
      targetContainerId: "trash",
    }),
  ).toEqual([]);
  expect(
    resolveContainerDocumentMoveUnlinkIds({
      currentContainerId: "root",
      linkedContainerIds: ["trash"],
      replaceLinkedContainers: false,
      targetContainerId: "trash",
    }),
  ).toEqual([]);
});

test("a non-replacing move unlinks only the current source when still linked", () => {
  expect(
    resolveContainerDocumentMoveUnlinkIds({
      currentContainerId: "root",
      linkedContainerIds: ["extra", "root", "trash"],
      replaceLinkedContainers: false,
      targetContainerId: "trash",
    }),
  ).toEqual(["root"]);
  // Moving onto a container the document already sits in unlinks nothing.
  expect(
    resolveContainerDocumentMoveUnlinkIds({
      currentContainerId: "trash",
      linkedContainerIds: ["root", "trash"],
      replaceLinkedContainers: false,
      targetContainerId: "trash",
    }),
  ).toEqual([]);
});
