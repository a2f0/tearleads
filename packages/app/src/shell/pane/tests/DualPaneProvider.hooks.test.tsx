import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import {
  DualPaneProvider,
  PaneSideProvider,
  usePaneSide,
  usePeerUserId,
  useRegisterUserId,
} from "../dual-pane";
import { useDualPane } from "../dual-pane/useDualPane";

afterEach(cleanup);

function RegisteredPaneUser({ userId }: { userId: string | null }) {
  useRegisterUserId(userId);
  return null;
}

function PeerUserProbe() {
  const peerUserId = usePeerUserId();
  return <div data-testid="peer-user-id">{peerUserId ?? "none"}</div>;
}

function DualPaneHookHarness() {
  const [showRightPaneUser, setShowRightPaneUser] = useState(true);

  return (
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PeerUserProbe />
      </PaneSideProvider>
      {showRightPaneUser && (
        <PaneSideProvider side="right">
          <RegisteredPaneUser userId="right-user" />
        </PaneSideProvider>
      )}
      <button type="button" onClick={() => setShowRightPaneUser(false)}>
        Unmount right user
      </button>
    </DualPaneProvider>
  );
}

// Harness where the right pane stays MOUNTED but its registered userId can
// change (login -> different user) or drop to null (logout/lock/key destroy),
// exercising the useRegisterUserId effect-change path rather than unmount.
function MountedRightPaneHarness({
  initialUserId,
}: {
  initialUserId: string | null;
}) {
  const [rightUserId, setRightUserId] = useState<string | null>(initialUserId);

  return (
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PeerUserProbe />
      </PaneSideProvider>
      <PaneSideProvider side="right">
        <RegisteredPaneUser userId={rightUserId} />
      </PaneSideProvider>
      <button type="button" onClick={() => setRightUserId(null)}>
        Log out right user
      </button>
      <button type="button" onClick={() => setRightUserId("right-user-2")}>
        Switch right user
      </button>
    </DualPaneProvider>
  );
}

test("registered pane user ids clear when a pane unmounts", () => {
  render(<DualPaneHookHarness />);

  expect(screen.getByTestId("peer-user-id").textContent).toBe("right-user");

  fireEvent.click(screen.getByText("Unmount right user"));

  expect(screen.getByTestId("peer-user-id").textContent).toBe("none");
});

// A pane that logs out (userId -> null) while still mounted must clear the peer
// slot for the other pane. Production wires useRegisterUserId to the nullable
// session userId (Pane.tsx / RoutedPane.tsx), which returns to null on
// logout/lock/key destroy without unmounting the pane — a path distinct from
// the unmount cleanup above and previously unasserted.
test("peer user id clears when a still-mounted pane logs out", () => {
  render(<MountedRightPaneHarness initialUserId="right-user" />);

  expect(screen.getByTestId("peer-user-id").textContent).toBe("right-user");

  fireEvent.click(screen.getByText("Log out right user"));

  expect(screen.getByTestId("peer-user-id").textContent).toBe("none");
});

// A mounted pane whose userId changes from A to B must leave the peer slot
// reading B — never null, and never the stale A. Guards the strict-equality
// guard in useRegisterUserId's cleanup against the A->B transition.
test("peer user id follows a mounted pane switching from one user to another", () => {
  render(<MountedRightPaneHarness initialUserId="right-user" />);

  expect(screen.getByTestId("peer-user-id").textContent).toBe("right-user");

  fireEvent.click(screen.getByText("Switch right user"));

  expect(screen.getByTestId("peer-user-id").textContent).toBe("right-user-2");
});

// The provider guards must throw, not silently fall back, when a hook is used
// outside its provider — a pane could otherwise register to a null setter or
// read a null side.
test("usePaneSide throws when used outside a PaneSideProvider", () => {
  expect(() => renderHook(() => usePaneSide())).toThrow(
    "usePaneSide must be used within a PaneSideProvider.",
  );
});

test("useDualPane throws when used outside a DualPaneProvider", () => {
  expect(() => renderHook(() => useDualPane())).toThrow(
    "useDualPane must be used within a DualPaneProvider.",
  );
});
