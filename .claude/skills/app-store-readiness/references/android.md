# Android / Google Play

## Policy and submission

Read the [Developer Policy Center](https://play.google/developer-content-policy/)
for the app's applicable policies, then check
[User Data](https://support.google.com/googleplay/android-developer/answer/10144311)
and [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469).
Reconcile the app and SDK data flows with the public policy, in-app policy
access, console answers, retention/deletion, backups, permissions, and account
deletion where applicable. No accounts or no collection can make individual
requirements N/A; it does not remove all privacy-policy obligations. Check
children, content, ads, payments, and sensitive permissions only when the
product/distribution context makes them relevant.

Verify current [target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
for the artifact, form factor, update/new-app status, date, and any approved
extension. Consult
[core app quality](https://developer.android.com/docs/quality-guidelines/core-app-quality)
for compatibility and behavior checks. Do not upgrade dependencies merely
because a newer SDK exists; distinguish an applicable submission floor from a
lint recommendation.

Inspect the merged release manifest and bundle: application ID, version code,
target/min SDK, signature, exported components, permissions, foreground
service types, native libraries, and platform/page-size compatibility if
native code is present. Test the minified (R8) output when the release build
minifies. Verify console declarations, app access, rating/target audience,
listings/screenshots, privacy URL, signing/track, production-access testing
eligibility, pre-launch reports, and policy issues with available console
evidence. Internal-track upload success is not proof of production approval or
eligibility.

## Interface and accessibility

Use [Compose accessibility defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults)
and [semantics](https://developer.android.com/develop/ui/compose/accessibility/semantics)
for native UI, and the web reference for content rendered in a WebView. Check
meaningful labels and roles, mutually exclusive selections, slider adjustment,
TalkBack traversal, focus return, headings, and non-color indicators. Check
48dp effective touch targets, large font/display settings, contrast in
light/dark, compact/large windows, edge-to-edge insets, rotation, and back
behavior, including that Back at the root leaves the app. Default components
can still be wrong when custom palettes or semantics override them.

Exercise cold launch, upgrade/persistence, process recreation, offline/error
behavior, permission denial, background limits, and the system integrations
the app actually uses. For media, include notifications, audio focus,
lock-screen controls, route changes, and widgets; for a WebView shell, include
file pickers and the camera, downloads and sharing, links that leave the app,
and the WebView versions the app supports. Use the accessibility tree and
automation as evidence of semantics and behavior; do not claim a TalkBack pass
without a screen-reader session.
