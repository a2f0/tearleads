import { expect, mock, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { useOrgManagerGrantsRefresh } from "./useOrgManagerGrantsRefresh";

type GrantsRefreshInput = Parameters<typeof useOrgManagerGrantsRefresh>[0];

function GrantsRefreshProbe({ input }: { input: GrantsRefreshInput }) {
  useOrgManagerGrantsRefresh(input);
  return null;
}

test("grants reconcile on entry and repaint locally on cursor changes", async () => {
  const refreshGrantsOnEntry = mock(async () => {});
  const refreshGrants = mock(async () => {});
  const baseInput = {
    enabled: true,
    readModelCursor: "cursor-1",
    refreshGrants,
    refreshGrantsOnEntry,
    visible: false,
  } satisfies GrantsRefreshInput;
  const view = render(<GrantsRefreshProbe input={baseInput} />);

  expect(refreshGrantsOnEntry).toHaveBeenCalledTimes(0);
  expect(refreshGrants).toHaveBeenCalledTimes(0);

  view.rerender(<GrantsRefreshProbe input={{ ...baseInput, visible: true }} />);
  await waitFor(() => {
    expect(refreshGrantsOnEntry).toHaveBeenCalledTimes(1);
  });
  expect(refreshGrants).toHaveBeenCalledTimes(0);

  const replacementEntryRefresh = mock(async () => {});
  view.rerender(
    <GrantsRefreshProbe
      input={{
        ...baseInput,
        refreshGrantsOnEntry: replacementEntryRefresh,
        visible: true,
      }}
    />,
  );
  expect(replacementEntryRefresh).toHaveBeenCalledTimes(0);

  view.rerender(
    <GrantsRefreshProbe
      input={{
        ...baseInput,
        readModelCursor: "cursor-2",
        refreshGrantsOnEntry: replacementEntryRefresh,
        visible: true,
      }}
    />,
  );
  await waitFor(() => {
    expect(refreshGrants).toHaveBeenCalledTimes(1);
  });
  expect(refreshGrantsOnEntry).toHaveBeenCalledTimes(1);
  expect(replacementEntryRefresh).toHaveBeenCalledTimes(0);

  view.rerender(
    <GrantsRefreshProbe
      input={{
        ...baseInput,
        enabled: false,
        readModelCursor: "cursor-3",
        refreshGrantsOnEntry: replacementEntryRefresh,
        visible: true,
      }}
    />,
  );
  view.rerender(
    <GrantsRefreshProbe
      input={{
        ...baseInput,
        readModelCursor: "cursor-3",
        refreshGrantsOnEntry: replacementEntryRefresh,
        visible: true,
      }}
    />,
  );
  await waitFor(() => {
    expect(replacementEntryRefresh).toHaveBeenCalledTimes(1);
  });
  expect(refreshGrants).toHaveBeenCalledTimes(1);
});
