import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import {
  DualPaneProvider,
  PaneSideProvider,
  usePeerUserId,
  useRegisterUserId,
} from "../DualPaneProvider";

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

test("registered pane user ids clear when a pane unmounts", () => {
  render(<DualPaneHookHarness />);

  expect(screen.getByTestId("peer-user-id").textContent).toBe("right-user");

  fireEvent.click(screen.getByText("Unmount right user"));

  expect(screen.getByTestId("peer-user-id").textContent).toBe("none");
});
