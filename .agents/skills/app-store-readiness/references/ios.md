# iOS and iPadOS

## Review and submission

Consult [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
for applicable completeness, metadata, business, design, and privacy rules.
Check crashes, reviewer access, truthful screenshots/descriptions, accessible
privacy links, and any account deletion, user-content moderation, sign-in, or
digital-purchase obligations that actually apply. Small feature sets require a
specific usefulness assessment; do not equate simplicity with automatic
rejection. Confirm review notes explain non-obvious behavior.

Write the App Review Information notes as the skill's reviewer packet; the
field holds at most 4,000 characters. Apple reviews on physical devices, so
install the exact candidate from TestFlight on a physical iPhone (and iPad when
supported) running the latest iOS release, walk the flow in the notes, and
record that session for the reviewer; simulator runs do not substitute.

Check these common first-review risks against the app and its metadata:

- Guideline 4.3(b): apps in the categories it calls well established (such as
  sound effects, flashlights, simple timers, and wallpapers) and their close
  neighbors (noise and sleep-sound players) are accepted only when
  meaningfully different or improved. State the difference
  concretely in the description and notes, and list the features beyond the
  basic one; a pitch built on doing a few things simply invites spam or
  minimum-functionality (4.2) scrutiny.
- Guideline 2.3.10: no names, icons, links, or imagery of other mobile
  platforms or marketplaces (Android, Google Play) in the iOS app or its
  metadata, including About screens and cross-promotion, unless they serve
  specific, approved interactive functionality. Search the shipped strings in
  every language and the listing, and guard them with a test.
- Guideline 1.4.1: diagnosis, treatment, and health-measurement claims get
  greater scrutiny. Back any such claim with disclosed methodology and any
  regulatory clearance, and remind users to consult a doctor; an app that makes
  none should say in the notes that it is not a medical device.

Verify current [submission requirements](https://developer.apple.com/news/upcoming-requirements/)
against the archive's SDK/toolchain, not just the installed Xcode. Check
app/extension IDs, entitlements, supported devices, signing, build numbering,
and processed build status. Use
[App Store Connect guidance](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app-for-review/)
to check the selected build, screenshots, privacy/support URLs, review
contact/access, age rating, export compliance, agreements, availability, and
pricing. Report unknown console fields separately from repository metadata. Do
not submit or fill declarations by inference.

Compare the implementation and SDKs with
[app privacy details](https://developer.apple.com/app-store/app-privacy-details/)
and [privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files).
Check required-reason API use in every target and embedded SDK, and the
manifests and signatures Apple requires of
[commonly used SDKs](https://developer.apple.com/support/third-party-SDK-requirements/).
Distinguish on-device storage from transmission, and account for backups and
external links. Inspect the packaged manifests; a checked-in file is not proof
it is included in the archive.

## Interface and accessibility

Use [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
and [accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility).
Exercise iPhone and iPad when both are supported, including compact/landscape
layouts, safe areas, keyboard, sheet scrolling/dismissal, Dynamic Type through
accessibility sizes, and light/dark contrast. Check effective touch targets,
not icon dimensions alone. In a WebView shell, confirm that web content follows
Dynamic Type, scrolled content stays clear of the status bar, and the keyboard
leaves focused fields and dialog actions visible on the smallest supported
iPhone.

Inspect the accessibility tree and test VoiceOver names, roles, values,
selected states, reading order, adjustable controls, focus after dismissal,
and chart alternatives. Check Switch Control/keyboard and reduced motion when
relevant. Use Accessibility Inspector or available UI automation to supplement
manual interaction, and record what was actually run.

Test the app's critical system integrations. For audio and background apps,
that means the lock screen, route changes, interruptions, competing audio, and
stopping/restarting from widgets or system controls; for others, substitute
theirs, such as camera and photo access, file sharing, emailed or universal
links, and networking in a WebView shell. Include offline/denied-permission/
error behavior and upgrade persistence. Physical-device behavior remains
unverified until tested there.
