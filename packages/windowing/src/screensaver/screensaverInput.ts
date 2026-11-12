import { trackHeldScreensaverInput } from "./screensaverHeldInput";
import type { ScreensaverEvent, ScreensaverState } from "./screensaverMachine";

const pointerReleases = [
  "pointerup",
  "mouseup",
  "touchend",
  "touchcancel",
  "pointercancel",
];

function dismissEvent(event: Event, hasHeldInput: boolean): ScreensaverEvent {
  return {
    type: "dismiss",
    escape: event instanceof KeyboardEvent && event.key === "Escape",
    drain:
      hasHeldInput ||
      pointerReleases.includes(event.type) ||
      ["keydown", "pointerdown", "mousedown", "touchstart"].includes(
        event.type,
      ) ||
      (event instanceof MouseEvent && event.buttons !== 0),
  };
}

function drainReleased(event: Event, held: Set<string>) {
  // Escape is an explicit recovery gesture even if a previous release was
  // lost. Keep its own keyup isolated before restoring the page.
  if (event instanceof KeyboardEvent && event.key === "Escape") {
    if (event.type === "keydown" || event.type === "keyup") held.clear();
    if (event.type === "keydown") held.add(`key:${event.code || event.key}`);
    return event.type === "keyup";
  }
  return (
    held.size === 0 &&
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
  );
}

export function captureScreensaverInput(
  readState: () => ScreensaverState,
  send: (event: ScreensaverEvent) => void,
  held: Set<string>,
  engaged: boolean,
) {
  const consume = (event: Event) => {
    const { status } = readState();
    trackHeldScreensaverInput(held, event, status !== "idle");
    if (status === "idle") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (status === "settling") return;
    if (status === "draining") {
      if (drainReleased(event, held)) send({ type: "released" });
      return;
    }
    send(dismissEvent(event, held.size > 0));
    // A press can start during grace and first dismiss on its release. Keep
    // isolation through the following click, even when nothing remains held.
    if (held.size === 0 && pointerReleases.includes(event.type))
      send({ type: "released" });
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
    window.addEventListener(type, consume, {
      capture: true,
      passive: !engaged,
    });
  const blur = () => {
    held.clear();
    send({ type: "released" });
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") blur();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("blur", blur);
  return () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("blur", blur);
    for (const type of events) window.removeEventListener(type, consume, true);
  };
}
