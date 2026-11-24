import { useReducer, useRef } from "react";
import { ScannerPhotoCleanupError } from "../../../host/Scanner";
import {
  type AvatarSource,
  transitionAvatarPicker,
} from "./avatarPickerMachine";

export function useAvatarPicker() {
  const [state, dispatch] = useReducer(transitionAvatarPicker, {
    status: "idle",
  });
  const nextRequest = useRef(0);

  // Start camera capture in the user gesture. A late response must still
  // belong to the active picker before it can open or dismiss the crop dialog.
  async function load(
    action: () => Promise<AvatarSource | null>,
    failure: string,
  ) {
    const request = ++nextRequest.current;
    dispatch({ type: "load", request });
    try {
      const source = await action();
      dispatch({ type: "loaded", request, source });
    } catch (error) {
      const message =
        error instanceof ScannerPhotoCleanupError
          ? "The photo was captured, but its temporary file could not be removed from this device. Choose a photo instead."
          : failure;
      dispatch({ type: "failed", request, message });
    }
  }
  function save(action: () => void | Promise<void>) {
    void load(async () => {
      await action();
      return null;
    }, "Could not save the avatar.");
  }
  return { state, dispatch, load, save };
}
