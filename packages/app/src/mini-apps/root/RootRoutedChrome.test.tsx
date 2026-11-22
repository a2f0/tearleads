import { afterEach, expect, mock, test } from "bun:test";
import { WindowMenuProvider, WindowToolBar } from "@tearleads/windowing";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useRootRoutedChromeActions } from "./RootRoutedChrome";
import type { RootRoute } from "./routes";

afterEach(cleanup);

function Chrome(props: Parameters<typeof useRootRoutedChromeActions>[0]) {
  useRootRoutedChromeActions(props);
  return null;
}

function renderChrome(route: RootRoute, historyCanGoBack: boolean) {
  const setRoute = mock();
  const openAudit = mock();
  const view = render(
    <WindowMenuProvider>
      <WindowToolBar />
      <Chrome
        historyCanGoBack={historyCanGoBack}
        openAudit={openAudit}
        route={route}
        setRoute={setRoute}
      />
    </WindowMenuProvider>,
  );
  const toolbar = () => within(view.getByRole("toolbar"));
  return { openAudit, setRoute, toolbar, view };
}

const IDENTITY_FROM_REPORT: RootRoute = {
  returnTo: { reportId: "revenuecat", view: "reports" },
  userId: "user-1",
  view: "identities",
};

test("with nothing to pop, Back replaces a detail with the view it came from", () => {
  const { setRoute, toolbar } = renderChrome(IDENTITY_FROM_REPORT, false);
  fireEvent.click(toolbar().getByRole("button", { name: "Back" }));
  expect(setRoute).toHaveBeenCalledWith(
    { reportId: "revenuecat", view: "reports" },
    { replace: true },
  );
});

test("where the host can step back, the console registers no Back of its own", () => {
  // A registered Back would push the parent instead of popping the entry the
  // detail left behind, and Back would then alternate between the two.
  const { openAudit, toolbar } = renderChrome(IDENTITY_FROM_REPORT, true);
  expect(toolbar().queryByRole("button", { name: "Back" })).toBeNull();
  fireEvent.click(toolbar().getByRole("button", { name: "Audit activity" }));
  expect(openAudit).toHaveBeenCalledWith("user-1");
});

test("a list carries neither Back nor Audit activity", () => {
  const { view } = renderChrome({ reportId: null, view: "reports" }, false);
  expect(view.queryAllByRole("button")).toEqual([]);
});
