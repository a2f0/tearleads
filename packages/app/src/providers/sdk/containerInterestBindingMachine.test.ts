import { describe, expect, test } from "bun:test";
import { createDomainScope } from "@tearleads/client-sdk";
import { transitionContainerInterestBinding } from "./containerInterestBindingMachine";

describe("transitionContainerInterestBinding", () => {
  test("rebinds in place when scope rotates before any declaration is sent", () => {
    const scope1 = createDomainScope();
    const scope2 = createDomainScope();
    const next = transitionContainerInterestBinding(
      { status: "awaiting-tree", scope: scope1 },
      {
        type: "scope-retired",
        scope: scope1,
        nextScope: scope2,
        canRebind: true,
        socketOpen: true,
      },
    );
    expect(next).toEqual({
      state: { status: "awaiting-tree", scope: scope2 },
      effect: "rebind",
    });
    // Stale-scope events are ignored by the machine itself.
    expect(
      transitionContainerInterestBinding(next.state, {
        type: "declaration-sent",
        scope: scope1,
      }),
    ).toEqual({ state: next.state, effect: "none" });
  });

  test("closes socket on same-scope retirement, sign-in boundary, closed socket, or post-declaration retirement", () => {
    const scope1 = createDomainScope();
    const scope2 = createDomainScope();
    expect(
      transitionContainerInterestBinding(
        { status: "awaiting-tree", scope: scope1 },
        {
          type: "scope-retired",
          scope: scope1,
          nextScope: scope1,
          canRebind: true,
          socketOpen: true,
        },
      ),
    ).toEqual({ state: { status: "stopped" }, effect: "close-socket" });

    expect(
      transitionContainerInterestBinding(
        { status: "awaiting-tree", scope: scope1 },
        {
          type: "scope-retired",
          scope: scope1,
          nextScope: scope2,
          canRebind: false,
          socketOpen: true,
        },
      ),
    ).toEqual({ state: { status: "stopped" }, effect: "close-socket" });

    expect(
      transitionContainerInterestBinding(
        { status: "awaiting-tree", scope: scope1 },
        {
          type: "scope-retired",
          scope: scope1,
          nextScope: scope2,
          canRebind: true,
          socketOpen: false,
        },
      ),
    ).toEqual({ state: { status: "stopped" }, effect: "close-socket" });

    const declared = transitionContainerInterestBinding(
      { status: "awaiting-tree", scope: scope1 },
      { type: "declaration-sent", scope: scope1 },
    );
    expect(declared).toEqual({
      state: { status: "declared", scope: scope1 },
      effect: "none",
    });
    expect(
      transitionContainerInterestBinding(declared.state, {
        type: "scope-retired",
        scope: scope1,
        nextScope: scope2,
        canRebind: true,
        socketOpen: true,
      }),
    ).toEqual({ state: { status: "stopped" }, effect: "close-socket" });
  });

  test("marks unavailable on bind failure and honors stop", () => {
    const scope = createDomainScope();
    const failed = transitionContainerInterestBinding(
      { status: "awaiting-tree", scope },
      { type: "bind-failed", scope },
    );
    expect(failed).toEqual({
      state: { status: "unavailable" },
      effect: "mark-unavailable",
    });
    expect(
      transitionContainerInterestBinding(failed.state, { type: "stop" }),
    ).toEqual({ state: { status: "stopped" }, effect: "none" });
  });
});
