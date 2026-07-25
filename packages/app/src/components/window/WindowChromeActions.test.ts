import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import {
  createTitleBarActions,
  type RegisteredWindowTitleBarAction,
} from "./WindowChromeActions";

function action(
  id: string,
  priority: number,
  placement: "penultimate" | null = null,
): RegisteredWindowTitleBarAction {
  return {
    disabled: false,
    icon: id as ReactNode,
    id,
    label: id,
    onClick: () => undefined,
    placement,
    priority,
  };
}

function orderedIds(
  actions: ReadonlyArray<RegisteredWindowTitleBarAction>,
): ReadonlyArray<string> {
  return createTitleBarActions(new Map(actions.map((item) => [{}, item]))).map(
    (item) => item.id,
  );
}

test("title bar actions use ids to stabilize equal priorities", () => {
  expect(orderedIds([action("move", 100), action("edit", 100)])).toEqual([
    "edit",
    "move",
  ]);
  expect(orderedIds([action("edit", 100), action("move", 100)])).toEqual([
    "edit",
    "move",
  ]);
});

test("the highest-priority placement request owns the penultimate slot", () => {
  expect(
    orderedIds([
      action("info", 300, "penultimate"),
      action("other-placement", 200, "penultimate"),
      action("edit", 100),
      action("sync", 50),
    ]),
  ).toEqual(["other-placement", "edit", "info", "sync"]);
});

test("a sole penultimate action remains the sole action", () => {
  expect(orderedIds([action("info", 300, "penultimate")])).toEqual(["info"]);
});
