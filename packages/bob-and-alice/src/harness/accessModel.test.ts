import { expect, test } from "bun:test";
import { AccessModel } from "./accessModel";

function tree() {
  const model = new AccessModel();
  for (const user of ["alice", "bob", "carol"]) model.addUser(user);
  model.addContainer({ containerId: "root", owner: "alice", parentId: null });
  model.addContainer({ containerId: "a", parentId: "root" });
  model.addContainer({ containerId: "b", parentId: "a" });
  model.addContainer({ containerId: "elsewhere", parentId: "root" });
  return model;
}

test("access is the strongest grant on any ancestor, direct or through a group", () => {
  const model = tree();
  model.addGroup("team", ["bob"]);
  model.grant("a", { kind: "group", id: "team" }, "read");
  model.grant("b", { kind: "user", id: "bob" }, "write");
  expect(model.containerLevel("bob", "a")).toBe("read");
  expect(model.containerLevel("bob", "b")).toBe("write");
  expect(model.containerLevel("alice", "b")).toBe("admin");
  expect(model.containerLevel("carol", "b")).toBeNull();

  model.revoke("b", { kind: "user", id: "bob" });
  expect(model.containerLevel("bob", "b")).toBe("read");
  model.removeGroupMember("team", "bob");
  expect(model.containerLevel("bob", "b")).toBeNull();
});

test("a move takes the subtree's inherited access with it", () => {
  const model = tree();
  model.grant("a", { kind: "user", id: "bob" }, "read");
  model.grant("elsewhere", { kind: "user", id: "carol" }, "read");
  model.moveContainer("b", "elsewhere");
  expect(model.containerLevel("bob", "b")).toBeNull();
  expect(model.containerLevel("carol", "b")).toBe("read");
});

test("a reader admitted late may keep the history that predates it", () => {
  const model = tree();
  model.addDocument("doc", "b", "v1");
  model.grant("a", { kind: "user", id: "bob" }, "read");
  model.revoke("a", { kind: "user", id: "bob" });
  model.edit("doc", "alice", "v2");
  expect(model.textsVisibleWithoutAccess("bob", "doc")).toEqual(["v1"]);
});

test("edits apply only for writers, and a lost reader keeps only what it could read", () => {
  const model = tree();
  model.grant("a", { kind: "user", id: "bob" }, "read");
  model.addDocument("doc", "b", "v1");
  expect(model.edit("doc", "bob", "bob's edit")).toBe(false);
  expect(model.latestText("doc")).toBe("v1");

  model.revoke("a", { kind: "user", id: "bob" });
  expect(model.edit("doc", "alice", "v2")).toBe(true);
  expect(model.canRead("bob", "doc")).toBe(false);
  expect(model.textsVisibleWithoutAccess("bob", "doc")).toEqual(["v1"]);
  expect(model.textsVisibleWithoutAccess("carol", "doc")).toEqual([]);
});
