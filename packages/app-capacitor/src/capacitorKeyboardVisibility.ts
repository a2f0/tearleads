import { Keyboard } from "@capacitor/keyboard";
import type { SubscribeKeyboardVisibilityFn } from "app/host/AppHostConfig";

export const subscribeCapacitorKeyboardVisibility: SubscribeKeyboardVisibilityFn =
  (listener) => {
    let subscribed = true;
    const notify = (visible: boolean) => {
      if (subscribed) {
        listener(visible);
      }
    };
    const handlePromises = [
      Keyboard.addListener("keyboardDidShow", () => notify(true)),
      Keyboard.addListener("keyboardDidHide", () => notify(false)),
    ];

    return () => {
      subscribed = false;
      for (const handlePromise of handlePromises) {
        void handlePromise.then((handle) => handle.remove()).catch(() => {});
      }
    };
  };
