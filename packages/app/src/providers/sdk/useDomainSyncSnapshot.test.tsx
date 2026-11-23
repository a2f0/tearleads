import { expect, spyOn, test } from "bun:test";
import {
  createDomainScope,
  type DomainScope,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { useDomainSyncSnapshot } from "./useDomainSyncSnapshot";

test("a mounted sync panel observes the replacement coordinator's lanes", async () => {
  const scope = createDomainScope();
  const panel = renderHook(() => useDomainSyncSnapshot(scope));
  try {
    await act(async () => getOrCreateDomainSyncCoordinator(scope).dispose());
    await act(async () => {
      getOrCreateDomainSyncCoordinator(scope).registerLane("replacement", {
        run: async () => {},
      });
    });
    expect(
      panel.result.current.lanes.some((lane) => lane.key === "replacement"),
    ).toBe(true);
  } finally {
    panel.unmount();
    getOrCreateDomainSyncCoordinator(scope).dispose();
  }
});

function LaneCount({ scope }: { scope: DomainScope }) {
  return <output>{useDomainSyncSnapshot(scope).lanes.length}</output>;
}

// Registers a lane while rendering, as a provider that builds its SDK runtime
// in a render-time memo does.
function RegistersWhileRendering({ scope }: { scope: DomainScope }) {
  const registered = useRef(false);
  if (!registered.current) {
    registered.current = true;
    getOrCreateDomainSyncCoordinator(scope).registerLane("from-render", {
      run: async () => {},
    });
  }
  return null;
}

test("a lane published while another component renders reaches views after that render", async () => {
  const scope = createDomainScope();
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  try {
    const view = render(<LaneCount scope={scope} />);
    view.rerender(
      <>
        <LaneCount scope={scope} />
        <RegistersWhileRendering scope={scope} />
      </>,
    );
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("1"));
    const updatesDuringRender = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes("Cannot update a component"),
    );
    expect(updatesDuringRender).toEqual([]);
    view.unmount();
  } finally {
    consoleError.mockRestore();
    getOrCreateDomainSyncCoordinator(scope).dispose();
  }
});
