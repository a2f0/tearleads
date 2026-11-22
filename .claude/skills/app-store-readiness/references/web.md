# Web release

A normal website has no App Store review. Evaluate web release quality and the
pages used by store reviewers. If the web app is packaged for a store, also
apply that store's reference and record the wrapper/distribution context.

Use [WCAG 2.2](https://www.w3.org/TR/WCAG22/) as the accessibility reference;
identify the chosen conformance level rather than claiming every
recommendation is a store rule. Check semantic names/roles/states, keyboard
operation and visible focus, modal focus and Escape/return behavior, status
announcements, contrast, target size/spacing, accessible charts, zoom/reflow,
text spacing, and reduced motion as relevant. WCAG target-size exceptions
differ from native design recommendations. A scan is evidence for the rules it
checks, not proof of full conformance. Provide manual keyboard and
screen-reader coverage or explicitly leave it unverified.

Test a production build in the supported browser engines, with a compact 320
CSS-pixel viewport and enlarged text/zoom, as well as a desktop window. Verify
public support/privacy links, metadata, language selection, form/control
labels, and all claimed features. Check that sticky controls do not obscure
focus and that dialogs remain scrollable on short viewports. Consult
[WAI dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
when implementing custom modal behavior; native semantics generally need less
custom code.

Inspect network requests, first-party hosting and any third-party services,
browser storage, and policy statements together. Exercise reload,
disabled/unavailable storage, offline startup versus an already-loaded page,
and visible failures. For media, test user-gesture startup,
background/suspension behavior, switching/stopping, and system controls. Do
not promise mobile-style background guarantees merely because desktop playback
worked.

For deployment readiness, check the built assets and hosting
preview/configuration through the documented workflow. Distinguish
local-candidate evidence from a live site's older version. If deployment is
authorized, verify its version and critical journeys afterward; otherwise
report the remaining deploy step without publishing as part of this audit.
