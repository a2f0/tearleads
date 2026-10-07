---
name: update-dependencies
description: Update a repository's dependency manifests, lockfiles, runtimes, tools, and CI pins with upstream migrations, compatibility checks, and non-destructive infrastructure previews.
---

# Update Dependencies

Use the repository's package managers and installed `agent-tool`. Read `AGENTS.md`,
README, linked setup/release documents, and repository-owned upgrade skills before
editing. Follow their hooks, version policy, checks, and requested stopping point.
Update applicable dependencies throughout the repository, including workspaces
and examples. This skill does not authorize deploying, merging, publishing, or
changing global tools; use existing user authorization and `ship-pr` when shipping
is requested. Default dependency-update merge subject: `chore: update dependencies`,
subject to repository title policy and any explicit user subject.

## Safety before execution

**Always dry-run before any infrastructure apply or deployment. Never destroy,
replace, or recreate a resource during an upgrade.** This includes Terraform,
OpenTofu, Wrangler, Ansible, other infrastructure tools, and effects triggered by
installation, tests, hooks, Git push, opening a PR, CI, or merging. Greenfield
projects and approval to ship do not waive this rule.

Before running project commands or pushing, trace their scripts, hooks, workflow
triggers, reusable workflows, and deployment commands. A dry-run flag alone is
insufficient: inspect tasks, provisioners, plugins, external programs, and actions
that can mutate despite preview mode. Avoid such a preview unless its effects
are proven read-only. Do not run destroy/delete, taint/replace, state removal,
backend migration, forced database reset, or an automatic "repair" that bypasses
the rule. Do not hide destruction with targeting, disabled refresh, ignored
changes, new resource identities, or weakened policy.

Preview with the proposed versions and complete configuration for each affected
environment, using its real backend/workspace/account, variables, inventory, and
resource identities. An empty local state, mocked credentials, validate-only run,
or bundle build cannot establish safety for production. Check the current baseline
as well when needed to distinguish existing drift from the upgrade. Keep state,
binary plans, JSON plans, and secret-bearing diffs out of Git and public reports.

If a preview proposes deletion or replacement, fails, is incomplete, omits
affected resources, or cannot establish safety, skip that dependency and its
coupled migrations. Restore only this task's edits to the affected compatibility
group, retain independent safe upgrades, and record the reason and affected
resources. Never apply to find out. A preview is not deployment authorization.

Before an authorized apply/deploy, verify the exact validated commit, toolchain,
configuration, environment, and current state still match the preview. Re-preview
after relevant changes or drift. CI must enforce the same order and stop on an
unsafe preview before mutation; a successful local preview does not excuse an
unguarded push- or merge-triggered deployment. Establish a narrowly scoped guard
when authorized and reviewable, or hold the affected upgrade before triggering
that workflow. Do not disable protections to ship. A plan must be inspected before
the operation; inspecting deployment logs afterward is too late.
An unsafe workflow triggered on every branch push also blocks pushing otherwise
independent upgrades until that trigger has a proven safe guard.

### Terraform and OpenTofu

Read core, provider, and module upgrade guides, including intermediate major
migrations. Regenerate provider locks with the pinned CLI, preserving supported
platform hashes. Backend initialization/migration is also subject to the safety
gate. Inspect external data programs and provisioners before planning.

Use a full refreshed saved plan with locking and the real variables, for example
`terraform plan -input=false -out=<private-plan>`; if using `-detailed-exitcode`,
0 and 2 are success, 1 is failure. Inspect `terraform show -json <private-plan>`.
Run `agent-tool dependencies check-terraform-plan <private-plan.json>` to check
supported JSON resource actions. It fails for every action containing `delete`,
including both replacement orders, unknown actions, incomplete/deferred plans,
failed checks, or opaque provider action invocations. It prints actions and
diagnostics without resource attribute values; it does not prove that a plan is
fresh, comprehensive, authentic, or that provider code has no hidden effects.
Older/unsupported plan formats that cannot establish completeness are skipped.
OpenTofu currently omits `complete` in its JSON format and is rejected by this
helper; report that limitation rather than adding a synthetic completeness flag.
Also inspect resource identity, drift, warnings, provider semantics, and any
effects outside resource actions. For an authorized apply, consume the exact
approved saved plan, not an uninspected newly generated plan.

Source: [Terraform JSON plan format](https://developer.hashicorp.com/terraform/internals/json-format).

### Wrangler and other deployment tools

Use the proposed pinned Wrangler for `wrangler deploy --dry-run` with the same
build/configuration/environment used by deployment. This checks bundling, not a
complete remote resource plan. Separately verify account, worker name, routes,
bindings and resource IDs against the existing deployment and read migration
semantics. Review Durable Object deleted/renamed classes, D1 schema/data
migrations, storage resources, queues, containers, and deployment integrations.
Never infer "no destruction" from a successful bundle. Resource removals,
replacement, or unprovable remote effects skip the affected group. Apply the
equivalent preview and identity checks to other tools rather than assuming they
share Terraform's guarantees.

Source: [Wrangler command documentation](https://developers.cloudflare.com/workers/wrangler/commands/).

### Ansible

Check controller Python, ansible-core, collections/roles, and target Python support
together; read porting guides. Inspect all tasks and invoked scripts before
`ansible-playbook --check --diff` with the real inventory and variables.
`check_mode: false` forces mutation even with `--check`; unsupported modules and
conditions based on registered results can omit effects. Inspect deletion,
recreation, service/data reset, and package removal semantics beyond the diff.
Skipped or opaque tasks are a safety gap, not a clean preview. Redact diffs.

Source: [Ansible check mode limits](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html).

## Inventory and choose compatible targets

Record each dependency source, current resolved version, latest stable candidate,
selected target, compatibility constraints, upstream migration links, and checks.
Query authoritative registries, official releases, support matrices, and migration
guides at execution time; do not treat remembered versions or prereleases as
latest stable. Inspect runtime requirements, peer dependencies, ABI/API changes,
platform availability, maintained release lines, and changed defaults, including
security, privacy/telemetry, data retention, and postinstall/native behavior.
Check transitive dependencies' peer/runtime constraints as well as direct ones. Unsupported
or unpublished targets stay pinned with an explanation.

Inventory manifests, locks, tool configuration, CI/reusable actions, containers,
scripts, deployment files, and executable documentation. Search duplicate version
pins and aliases, not just filenames; exclude vendored/generated snapshots unless
the repository owns their update process. Examples of sources to inspect:

| Ecosystem | Sources and compatibility group |
| --- | --- |
| JavaScript/TypeScript | All package.json dependency fields, overrides/resolutions, workspace catalogs, packageManager/engines, npm/Bun/pnpm/Yarn locks, Node/Bun pins, compiler and lint/build/test plugins |
| Toolchains | mise.toml/.mise.toml, mise.lock, .tool-versions, runtime version files, tool URLs/checksums, CI pins and container images; include every tool declared by mise, not just mise itself |
| Python/Ansible | pyproject/requirements, uv/Poetry/pip locks, Python pins, ansible-core, collection/role requirements, lint plugins and managed host constraints |
| Ruby/iOS | .ruby-version, Gemfile/lock, Bundler, CocoaPods, Podfile/lock, podspecs, Swift packages and Xcode/iOS deployment requirements |
| Infrastructure | Terraform/OpenTofu CLI constraints, provider locks/constraints, module versions/Git refs, Wrangler and Cloudflare integration dependencies |
| CI/system/native | Actions/reusable workflow refs, Docker tags/digests, OS images/packages, Rust/Cargo toolchain and locks, Go modules, Gradle/AGP/Kotlin/JDK and other repository-specific manifests |

Build connected compatibility groups before editing. Select the newest supported
combination, which can be older than an individual package's latest. Upgrade the
framework first or keep its compatible toolchain pinned; do not force peer
resolution, drop compatibility checks, or add blanket overrides to make installs
pass. Preserve source pin policy (exact version, digest, full Git SHA) and resolve
immutable pins from verified upstream releases. Preserve intentional runtime
minimums unless migration requires changing the support contract.

For React Native, use its version-specific upgrade guide/template diffs and
repository upgrade skills. Couple React and its renderer, native modules,
Metro/Babel, CLI, codegen, Hermes/New Architecture, CocoaPods/Bundler/Ruby,
Xcode/iOS deployment targets, and Android Gradle/AGP/Kotlin/JDK/SDK/NDK. For Expo,
use the chosen SDK's supported React Native/dependency matrix and its dependency
checks. Do not independently update framework-managed pods or generated native
files; use the framework's regeneration workflow and prove iOS/Android builds.
Permissive peer ranges alone do not prove native renderer or toolchain compatibility;
check the framework's actual supported versions and native implementation.
An unavailable native toolchain is a reported validation limit; do not claim the
group verified. See [React Native upgrading](https://reactnative.dev/docs/upgrading).

Check developer tools' own dependencies too: a compiler release without its old
programmatic API may break test/lint runners that import it even when `tsc` passes.
Action runtime upgrades can require newer self-hosted runners; preserve workflow
permissions, action inputs/outputs, caching, artifact semantics, and job names.

Check current advisories with read-only ecosystem audits against the baseline and
proposed lockfiles, using the repository's configured registry/advisory sources.
Do not send private dependency metadata to an unconfigured or unauthorized service;
report the resulting coverage limit. Cover direct and resolved transitive dependencies,
including native/platform-specific binaries. Latest direct packages can still
pin vulnerable transitive versions. Trace each finding to its owning dependency,
verify affected versions, runtime conditions, and remediation in the maintainer's
advisory and fixed release. When the owner's range permits a fixed version, use a
targeted refresh with the lockfile's owning manager and preserve unrelated
resolutions; otherwise prefer a supported owner upgrade.
If the owner still pins a vulnerable version, a narrowly scoped security patch
override may be used only with API/ABI/runtime compatibility evidence and focused
regression checks of the actual affected integration. Document its rationale and
removal condition; a passing install or bundle alone is insufficient. Do not run
blind audit fixes or use blanket overrides to bypass compatibility constraints.
Report unresolved advisories and unavailable audit coverage accurately; current
direct pins or a partial clean audit do not
establish that the whole dependency graph is safe.

## Migrate and validate

Capture relevant baseline checks and warnings first, after screening their side
effects. Update one compatibility group at a time. Read the upstream instructions
for every breaking step; implement required source/config/schema migrations and
removed API replacements. Use the manager that owns each lockfile, on the selected
runtime, and inspect the resulting diff. Refresh transitive dependencies through
their owning direct dependency; do not hand-edit integrity hashes or lock entries.
Review intentional patches, overrides, and pins before removal; retain them until
upstream fixes and regression checks demonstrate they are unnecessary.
Avoid unrelated global installations or environment changes. Use task-local or
repository-scoped tools for testing changed runtime pins.
For published packages, also validate tarballs and consumer installs with their
documented supported package managers, including manifest/override syntax and
runtime requirements. A successful owning-manager install does not prove that
published metadata works for those consumers.

Run the repository's setup/hooks, frozen installs, lint, typechecks, tests, builds,
package/platform smoke checks, and relevant safe integration previews. Resolve
upgrade-related deprecation warnings at their source. Do not suppress warnings,
weaken tests, or disable checks; report remaining upstream/pre-existing warnings
with evidence and keep a target pinned when migration cannot be completed.
Add focused regression coverage when a migration changes behavior; avoid tests
that merely assert version strings. Re-run checks after repairs. Report checks
blocked by missing credentials, platforms, or external services accurately.
Re-audit the final resolved graph after migrations and repairs.

Confirm every inventory row is upgraded, already current, intentionally constrained,
or skipped with a concrete reason. Do not present an unresolved group as complete.
When upgrading agent-tool itself, install its managed skills with the same harness
scope and commit the ownership manifest; never edit generated managed skill copies.

When changes depend on another repository's release, ship the producer first and
confirm publishing and registry availability before pinning the consumer; include
its exact version/commit and API migration notes. Independent groups may proceed.
Use the installed `ship-pr` for authorized shipping and independently review every
changed HEAD. Check deployment safety again before its push/open/merge operations.

## Report

Keep a compact ledger of old/selected versions, completed migrations, validation
and warning results, preview environment/commit/tool versions and safe action
summary, and every skipped/constrained dependency with the reason. Include baseline
and final audit results, security overrides with their rationale and removal
condition, unresolved advisories, and audit coverage limits. For shipping,
include branch, reviewed commit/verdict, PR, merge, publish/deploy result, and final
checkout state. For a repository sweep, keep one entry per repository, including
unready or unchanged checkouts. Do not publish credentials, state, or plan contents.
