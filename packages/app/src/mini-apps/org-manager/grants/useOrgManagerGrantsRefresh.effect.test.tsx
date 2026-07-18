import { expect, mock, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { useOrgManagerGrantsRefresh } from "./useOrgManagerGrantsRefresh";

type GrantsRefreshInput = Parameters<typeof useOrgManagerGrantsRefresh>[0];

function GrantsRefreshProbe({ input }: { input: GrantsRefreshInput }) {
  useOrgManagerGrantsRefresh(input);
  return null;
}

test("grants entry and re-entry repaint only from the local projection", async () => {
  const refreshGrants = mock(async () => {});
  const baseInput = {
    enabled: true,
    readModelCursor: "cursor-1",
    refreshGrants,
    visible: false,
  } satisfies GrantsRefreshInput;
  const view = render(<GrantsRefreshProbe input={baseInput} />);

  expect(refreshGrants).toHaveBeenCalledTimes(0);

  view.rerender(<GrantsRefreshProbe input={{ ...baseInput, visible: true }} />);
  await waitFor(() => {
    expect(refreshGrants).toHaveBeenCalledTimes(1);
  });

  const replacementLocalRefresh = mock(async () => {});
  view.rerender(
    <GrantsRefreshProbe
      input={{
        ...baseInput,
        refreshGrants: replacementLocalRefresh,
        visible: true,
      }}
    />,
  );
  expect(replacementLocalRefresh).toHaveBeenCalledTimes(0);

  view.rerender(
    <GrantsRefreshProbe
      input={{
        ...baseInput,
        readModelCursor: "cursor-2",
        refreshGrants: replacementLocalRefresh,
        visible: true,
      }}
    />,
  );
  await waitFor(() => {
    expect(replacementLocalRefresh).toHaveBeenCalledTimes(1);
  });
  expect(refreshGrants).toHaveBeenCalledTimes(1);

  view.rerender(
    <GrantsRefreshProbe
      input={{
        ...baseInput,
        enabled: false,
        readModelCursor: "cursor-3",
        refreshGrants: replacementLocalRefresh,
        visible: true,
      }}
    />,
  );
  view.rerender(
    <GrantsRefreshProbe
      input={{
        ...baseInput,
        readModelCursor: "cursor-3",
        refreshGrants: replacementLocalRefresh,
        visible: true,
      }}
    />,
  );
  await waitFor(() => {
    expect(replacementLocalRefresh).toHaveBeenCalledTimes(2);
  });
  expect(refreshGrants).toHaveBeenCalledTimes(1);
});
