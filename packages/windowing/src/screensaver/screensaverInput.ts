import type { ScreensaverEvent, ScreensaverState } from "./screensaverMachine";

function dismissEvent(event: Event): ScreensaverEvent {
  return {
    type: "dismiss",
    escape: event instanceof KeyboardEvent && event.key === "Escape",
    drain:
      ["keydown", "pointerdown", "mousedown", "touchstart"].includes(
        event.type,
      ) ||
      (event instanceof MouseEvent && event.buttons !== 0),
  };
}

export function captureScreensaverInput(
  readState: () => ScreensaverState,
  send: (event: ScreensaverEvent) => void,
) {
  const consume = (event: Event) => {
    if (readState().status === "idle") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (readState().status === "settling") return;
    if (readState().status === "draining") {
      if (
        [
          "keyup",
          "pointerup",
          "mouseup",
          "touchend",
          "touchcancel",
          "pointercancel",
          "click",
          "contextmenu",
        ].includes(event.type)
      )
        send({ type: "released" });
      return;
    }
    send(dismissEvent(event));
  };
  const events = [
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
    "keydown",
    "keyup",
    "keypress",
    "pointerdown",
    "pointerup",
    "pointermove",
    "pointercancel",
    "mousedown",
    "mouseup",
    "mousemove",
    "touchstart",
    "touchend",
    "touchmove",
    "touchcancel",
    "wheel",
  ];
  for (const type of events)
    window.addEventListener(type, consume, { capture: true, passive: false });
  const blur = () => send({ type: "released" });
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("blur", blur);
    for (const type of events) window.removeEventListener(type, consume, true);
  };
}
