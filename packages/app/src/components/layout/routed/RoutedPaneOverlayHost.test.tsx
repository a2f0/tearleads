import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  RoutedPaneOverlayHostProvider,
  useRoutedPaneOverlayHost,
} from "./RoutedPaneOverlayHost";

afterEach(cleanup);

// A probe standing in for the overlays that consume the pane — it reports what
// the context handed it, which is the whole contract.
function HostProbe() {
  const { host, tier } = useRoutedPaneOverlayHost();
  return (
    <span data-host={host?.className ?? "none"} data-testid="probe">
      {tier}
    </span>
  );
}

// Outside the routed shell there is no pane to fill, and the narrower tier is
// the safe assumption: an overlay that gates on `tablet` then keeps the
// viewport rather than portaling into a host that is not there.
test("the default value offers no pane and the narrower tier", () => {
  const view = render(<HostProbe />);
  const probe = view.getByTestId("probe");

  expect(probe.getAttribute("data-host")).toBe("none");
  expect(probe.textContent).toBe("mobile");
});

test("the provider hands its pane element and tier to consumers", () => {
  const pane = document.createElement("div");
  pane.className = "routed-pane-main";

  const view = render(
    <RoutedPaneOverlayHostProvider value={{ host: pane, tier: "tablet" }}>
      <HostProbe />
    </RoutedPaneOverlayHostProvider>,
  );
  const probe = view.getByTestId("probe");

  expect(probe.getAttribute("data-host")).toBe("routed-pane-main");
  expect(probe.textContent).toBe("tablet");
});
