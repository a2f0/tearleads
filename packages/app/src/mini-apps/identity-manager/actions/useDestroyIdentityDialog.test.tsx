import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useDestroyIdentityDialog } from "./useDestroyIdentityDialog";

test("a busy identity operation keeps the captured deletion target available for retry", async () => {
  const destroyKey = mock(async (_fingerprint: string) => false);
  const onDestroyed = mock(() => {});
  const view = renderHook(
    ({ signingFingerprint }) =>
      useDestroyIdentityDialog({ destroyKey, onDestroyed, signingFingerprint }),
    { initialProps: { signingFingerprint: "identity-a" } },
  );
  try {
    act(() => view.result.current.requestDestroyKeyPackage());
    view.rerender({ signingFingerprint: "identity-b" });
    await act(async () => view.result.current.confirmDestroyKeyPackage());
    expect(destroyKey).toHaveBeenLastCalledWith("identity-a");
    expect(view.result.current.isDestroyKeyPackageDialogOpen).toBe(true);
    expect(view.result.current.destroying).toBe(false);
    expect(view.result.current.destroyError).toContain("Try again");
    expect(onDestroyed).not.toHaveBeenCalled();

    destroyKey.mockImplementation(async () => true);
    await act(async () => view.result.current.confirmDestroyKeyPackage());
    expect(destroyKey).toHaveBeenLastCalledWith("identity-a");
    expect(view.result.current.isDestroyKeyPackageDialogOpen).toBe(false);
    expect(view.result.current.destroyError).toBeNull();
    expect(onDestroyed).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
  }
});
