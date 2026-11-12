# Lessons

Cross-repository lessons from explicit-state-machine passes. Add one when a
pass learns something the next repository needs; keep repository-specific
findings in that repository's guidance.

- The script's `flags` signal skips `cancelled` and `settled`: effect cleanups
  and promise races set them once as guards, which is not a machine.
- Type members and returned object literals (`status: "idle"`) are how an
  explicit machine names its states, so the `status` signal counts only
  assignments and setter calls.
- The first sweep (16 repositories) found real machines the scanner missed:
  React refs (`busy.current`), `#private` fields, in-place writes to nested
  objects (`record.steps[i].status`), lifecycle booleans not named `is*`
  (`booting`, `paging`), extensionless and Expect scripts, and nullable values
  paired with flags. The first five are now signals; read for the last by hand.
- A ref mirroring a state (`isSubmitting` with `isSubmittingRef`) now shows as
  two flags; it is worth reading, since the pair can disagree.
- Server status columns in balebase and devopsrockstars were already guarded:
  every write, in one module, is a conditional update naming the states it
  may leave. The scanner still lists them; the skill says when that suffices.
- Repositories with no runtime state (seed data, one-shot CLIs, dotfiles)
  closed as `unchanged` within minutes; let them, and record what was read.
- Converting found real bugs: a step that stayed `running` forever after its
  runner failed to start, a gallery acting on a detached render, a bootstrap
  gate blocked forever when prerequisites vanished mid-run, two menus closing
  on one press, duplicate stop logs on a second focus loss.
- Second and third rounds in balebase and tearleads, driven by the widened
  scanner, found one more real bug (a checkout link minting two Stripe
  sessions on a double click) and several false positives now named in the
  skill's leave-alone list: in-flight-plus-rerun flags, ref mirrors, and flag
  pairs split across a parent and a conditionally mounted child.
- Bug fixes the sweep surfaced outside state machines shipped as their own
  `fix/` PRs: a swallowed settings-write error, a partial download cached
  forever, an audio session never released, a verify step failing during
  registry propagation, and a CI runner image that broke browser tests.
- A nullable `error` shared by a load and user actions hid a real bug in
  devopsrockstars' Stripe payment step: after a failed load, Cancel cleared
  the error and the step showed "Loading..." again. A `loading | ready |
  failed` load machine with separate action errors fixed it
  (devopsrockstars#898). The scanner sees booleans only; read for it by hand.
- The second sweep's perennial false positives are now named: guarded SQL
  status updates (devopsrockstars checkout and webhooks, balebase contracts
  and jobs) and enum payload labels are skipped by the scanner, along with
  `*.testUtils.*` files; latest-wins request counters, set-once setup flags,
  one-time focus-return refs, and memoized teardown promises are in the
  skill's leave-alone list.
  An update whose `WHERE` has an `OR`, a `NOT` or a subquery still counts,
  even when every branch names the from-state (balebase finance): read it by
  hand.
