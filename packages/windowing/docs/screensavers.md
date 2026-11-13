# Screensavers

Part of [@tearleads/windowing](../README.md).

Mount one `ScreensaverProvider` around the host's desktop and taskbar. It needs
no window-state or launcher provider. Use the bundled grayscale
`LaserScreensaver` or supply your own animation. The host supplies the control
that starts it; this package adds no idle timer, saved preference, or global
launch shortcut.

```tsx
import {
  LaserScreensaver,
  ScreensaverProvider,
  useScreensaver,
} from "@tearleads/windowing";

function StartScreensaver() {
  const { start } = useScreensaver();
  return <button onClick={start}>Start screensaver</button>;
}

<ScreensaverProvider screensaver={LaserScreensaver}>
  <Desktop />
  <Taskbar />
  <StartScreensaver />
</ScreensaverProvider>;
```

A custom animation is a React component with no required props. It mounts only
while active, inside a viewport-sized container; a canvas can use `width: 100%`
and `height: 100%`. It owns its animation and must cancel its work on unmount.
Replacing the component while active replaces only that animation, not the
session or grace timer. Styles are included by the public import.

`useScreensaver()` returns stable `start()` and `stop()` callbacks and an
`isActive` boolean (artwork or a PIN gate is visible). It throws outside the
provider. Repeated starts while active are ignored. Without a PIN, `stop()`
exits immediately and intentionally cancels input isolation, including a
pending release tail; reserve it for explicit host control or teardown, not an
effect watching `isActive`. With a PIN, `stop()` requests the PIN gate instead
and cannot bypass verification. Start and stop do not close, minimize, or
recreate the host's windows.

The optional `gracePeriodMs` defaults to `2000`. Input during that initial
period is consumed without dismissal; Escape always wakes it. After grace,
keyboard, pointer, mouse, touch, and wheel activity wake it. The dismissing
input and that discrete press's release/click tail are consumed so the desktop
does not receive an accidental click or shortcut. After that tail settles,
later presses are new host input, including a double-click's second press.
A new start during the isolated tail is ignored until
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
inertness, per the [HTML modal dialog rules][modal-inertness]. Without a PIN,
the page remains inert through the waking press's tail even after the overlay
unmounts. A PIN-protected session keeps its overlay through the unlock prompt.
The animation is inert and hidden from assistive technology; the dialog
announces "Screensaver" and the exit or unlock instruction. Focus returns to the
previous connected element unless the host has moved it elsewhere. Existing
body inertness is restored, not unconditionally removed.
The PIN form receives normal DOM events. Host-level capture listeners must
ignore modal input or suspend global shortcuts while `isActive` is true;
page inertness does not disable document/window event listeners.

## PIN unlock

Pass `verifyPin` only when the host has a PIN configured:

```tsx
<ScreensaverProvider
  screensaver={LaserScreensaver}
  verifyPin={pinCodeEnabled ? verifyExistingPin : undefined}
>
  <Desktop />
</ScreensaverProvider>
```

`ScreensaverPinVerifier` is `(pin, signal) => Promise<boolean>`. It checks the
host's existing PIN without changing the host's session or keyring state;
only `true` removes the gate. Windowing never stores a PIN configuration or
verifies one itself. The verifier is captured for that session, so removing
the prop cannot bypass an already-started PIN gate. Keep the provider mounted
across host layout changes.

Wake input drains its release/click tail, then shows a full-screen unlock
surface with a focused password field. **Cancel** or **Escape** returns to the
animation, clears the entered PIN, and starts a fresh grace period after the
cancelling input has settled. Native dialog cancellation does the same;
native closure cannot reveal the desktop. Wrong PINs and verifier errors
retain the gate and allow another attempt.

Cancellation and unmount abort the verifier's `AbortSignal`. Verifiers should
honor it and must not unlock or otherwise mutate host state. Late results are
ignored even after another attempt starts. Successful verification drains any
still-held input before restoring the desktop. Rate limiting and credential
policy belong to the host.

The bundled lasers draw six grayscale trails, resize with the viewport, and
show a static composition with reduced motion. Their work stops on unmount.

Use a browser with native modal dialogs and `inert` support. This is a privacy
screen, not an OS lock or a security boundary: application data, editor state,
and sessions stay live underneath. It is not persisted across reloads. Use the
host's separate full Lock action when key/session teardown is required.
Host code should not open competing modal dialogs or change body inertness
during a session. Mount the provider only where screensaver behavior is wanted;
routed layouts need not include it.

[modal-inertness]: https://html.spec.whatwg.org/multipage/interaction.html#modal-dialogs-and-inert-subtrees
