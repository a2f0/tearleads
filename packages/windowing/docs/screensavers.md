# Screensavers

Part of [@tearleads/windowing](../README.md).

Mount one `ScreensaverProvider` around the host's desktop and taskbar. It needs
no window-state or launcher provider. The host supplies the animation and the
control that starts it; this package adds no animation, idle timer, saved
preference, or global launch shortcut.

```tsx
import { ScreensaverProvider, useScreensaver } from "@tearleads/windowing";

function StartScreensaver() {
  const { start } = useScreensaver();
  return <button onClick={start}>Start screensaver</button>;
}

<ScreensaverProvider screensaver={MyAnimation}>
  <Desktop />
  <Taskbar />
  <StartScreensaver />
</ScreensaverProvider>;
```

`MyAnimation` is a React component with no required props. It mounts only while
active, inside a viewport-sized container; a canvas can use `width: 100%` and
`height: 100%`. It owns its animation and must cancel its work on unmount.
Replacing the component while active replaces only that animation, not the
session or grace timer. Styles are included by the public import.

`useScreensaver()` returns stable `start()` and `stop()` callbacks and an
`isActive` boolean. It throws outside the provider. Repeated starts while active
are ignored. `stop()` exits immediately and intentionally cancels input
isolation, including a pending release tail; reserve it for explicit host
control or teardown, not an effect watching `isActive`. Start and stop do not
close, minimize, or recreate the host's windows.

The optional `gracePeriodMs` defaults to `2000`. Input during that initial
period is consumed without dismissal; Escape always exits. After grace,
keyboard, pointer, mouse, touch, and wheel activity dismiss. The dismissing
input and its release/click tail are consumed so the desktop does not receive
an accidental click or shortcut. A new start during that tail is ignored until
the gesture finishes. Idle listeners are passive and retain only modifiers,
not ordinary key presses. Meta release clears keys whose release the browser
omitted; losing focus or hiding the page clears the tail too. If a release is
lost while the page stays visible, press and release Escape to recover.
There is deliberately no deadline that unlocks under a still-held pointer:
that would allow its later release to click through. Escape is the explicit
recovery action, and its own release is consumed. Unmounting the provider
clears listeners and timers too. Isolation covers discrete releases/clicks,
not later trackpad momentum events after a wheel dismissal. Changing
`gracePeriodMs` during grace restarts the timer; `0` disables grace, so hosts
launching with a key should keep a positive grace period for that key's release.

The overlay is a native modal `dialog` in the document body, above windows and
the taskbar in the browser's top layer. It hides the cursor and makes the page
inert, including embedded frames. Native modal dialogs escape ancestor
inertness, per the [HTML modal dialog rules][modal-inertness]. The page
remains inert while a dismissing
press finishes, even though the animation and overlay have unmounted. The
animation itself is inert and hidden from assistive technology; the dialog
announces "Screensaver" and the Escape instruction. Focus returns to the
previous connected element unless the host has moved it elsewhere. Existing
body inertness is restored, not unconditionally removed.

Use a browser with native modal dialogs and `inert` support. This is a visual
screensaver, not an authentication lock or security boundary. Host code should
not open competing modal dialogs or change body inertness during a session.
Mount the provider only in layouts where the host wants screensaver behavior;
routed layouts need not include it.

[modal-inertness]: https://html.spec.whatwg.org/multipage/interaction.html#modal-dialogs-and-inert-subtrees
