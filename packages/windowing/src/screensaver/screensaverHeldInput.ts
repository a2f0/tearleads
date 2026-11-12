// Raw input inventory, independent of screensaver lifecycle. Observe idle
// input too, since a modifier may already be down when the host starts it.
function trackModifiers(held: Set<string>, event: KeyboardEvent | MouseEvent) {
  // Input first held in an iframe cannot be observed by the parent. The next
  // key/pointer event carries its modifier flags across the focus change.
  const modifiers = {
    Alt: event.altKey,
    Control: event.ctrlKey,
    Meta: event.metaKey,
    Shift: event.shiftKey,
  };
  for (const [name, pressed] of Object.entries(modifiers)) {
    const id = `modifier:${name}`;
    if (pressed) held.add(id);
    else held.delete(id);
  }
}

function trackKey(
  held: Set<string>,
  event: KeyboardEvent,
  includePresses: boolean,
) {
  // Meta combinations may omit the ordinary key's release on macOS.
  if (event.type === "keyup" && event.key === "Meta") {
    for (const key of held) if (key.startsWith("key:")) held.delete(key);
  }
  if (
    !includePresses &&
    !["Alt", "Control", "Meta", "Shift"].includes(event.key)
  )
    return;
  const key = `key:${event.code || event.key}`;
  if (event.type === "keydown") held.add(key);
  if (event.type === "keyup") held.delete(key);
}

export function trackHeldScreensaverInput(
  held: Set<string>,
  event: Event,
  includePresses: boolean,
) {
  if (event instanceof KeyboardEvent || event instanceof MouseEvent) {
    trackModifiers(held, event);
  }
  if (event instanceof KeyboardEvent) {
    trackKey(held, event, includePresses);
    return;
  }
  if (!includePresses) return;
  const pointer = event instanceof PointerEvent ? event.pointerId : 0;
  const button = event instanceof MouseEvent ? event.button : 0;
  switch (event.type) {
    case "pointerdown":
      held.add(`pointer:${pointer}`);
      break;
    case "pointerup":
    case "pointercancel":
      held.delete(`pointer:${pointer}`);
      break;
    case "mousedown":
      held.add(`mouse:${button}`);
      break;
    case "mouseup":
      held.delete(`mouse:${button}`);
      break;
    case "touchstart":
      held.add("touch");
      break;
    case "touchend":
    case "touchcancel":
      if (
        typeof TouchEvent === "undefined" ||
        !(event instanceof TouchEvent) ||
        event.touches.length === 0
      ) {
        held.delete("touch");
      }
      break;
  }
}
