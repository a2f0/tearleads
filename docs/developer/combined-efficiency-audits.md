# Combined efficiency audits

Apply this when one request asks for both the `database-efficiency-audit` and
the `protocol-efficiency-audit` at one revision. The two skills split one
surface: the database audit owns statements, query shape, transaction scope,
and indexes; the protocol audit owns requests, bytes, tables, and mechanisms.
Run apart, each lists findings for the other that nobody answers, and savings
on the same statements are counted twice. A combined run shares one baseline,
has each audit answer the other's hand-off, and may publish one report.

This procedure does not authorize an audit or publication. Each skill's own
gates, rules, batching limits, and
[usage receipt](audit-usage-receipts.md) still apply.

## Shared baseline

1. Pin one full commit for both audits and measure from one clean detached
   checkout outside the repository tree, set up once: `bun install`, the
   Electrobun devkit prepare step, and the client SDK build. Neither audit
   installs, rebuilds, edits, or removes that checkout.
2. Run the eight request-volume canaries once for both audits, with the
   profile variables from the protocol skill's measurement reference and the
   SQL capture preload from the database skill's. Extract the preload from
   the audited revision's copy of the skill: it changes between revisions.
   Set `SQL_CAPTURE_PARAM_HASH=1` so either audit can tell a repeated key
   from a different one; the hashes stay in the private directory.
3. Give each audit its own audit directory, run ID, usage ledger, scratch
   directories, and scratch databases. Share only the checkout, the canary
   output, and a lock for heavy runs (canaries, multi-file test runs), so the
   two audits do not skew each other's timings.

## Hand-off rule

A finding belongs to the protocol audit only if acting on it needs a new or
changed field, route, response, stored table content, or local client rule.
A finding that changes only query shape, statement batching, transaction
scope, lock scope, or an index belongs to the database audit, including a
cache or batch message inside one process. On 2026-11-10 five of thirteen
leads handed to the protocol audit came straight back under this rule.

Write the hand-off as numbered leads, one claim each, in
`leads-for-other-audit.md`: the `file:line`, the claimed saving with its unit
and source label, and why it is outside the writing audit's rules. A bullet
that carries several claims hides the ones that are only partly true.

## Draft mode

With the `draft-only` argument a coordinator runs its skill unchanged up to
the report step, then writes drafts instead of publishing. It never creates,
edits, or comments on an issue. In its audit directory it writes:

- `issue.md`: the whole report in its issue template's section order, one
  `##` heading per section and one `###` heading per proposal, in one file.
  It is not split for GitHub's size limit and no evidence is dropped; the
  publisher splits at headings.
- `issue-title.txt`: the title its template would use, `Partial` prefix
  included.
- `proposals.json`: one object per ranked proposal (`id`, `title`, `slice`,
  `impact`, `risk`, `label`, `saves`, and `dialects` or `retires`), and one
  object with `"unranked": true` and a `kind` for each ruling, capability
  trade, estimate, and open lead.
- `leads-for-other-audit.md`, as above.

Ids are disjoint across the two audits. The database audit numbers ranked
proposals `D1`, `D2`, and so on, and unranked items `D-R1` (ruling), `D-E1`
(estimate), `D-O1` (open lead); the protocol audit uses `P1`, `P-R1`, `P-E1`,
and `P-T1` (capability trade). Never write a bare `#` before a number that is
not an issue: GitHub links `#68` to issue 68.

The receipt section stays in `issue.md` with the run's markers. A coordinator
cannot see its own final counters, so it records what its harness exposes and
marks the rest unavailable for the publisher to reconcile after it exits. The
checkpoint records `publication: pending` and who publishes.

## Reconciliation batch

When both audits have drafted, each coordinator resumes for one batch with
the `reconcile <other-audit-directory>` argument, under the same run ID and a
new batch ID.

1. Split the other audit's hand-off into numbered leads and check each
   lead's premise before its fix. Give each one disposition:
   - `covered`: a ranked proposal already does it; name the id.
   - `ranked`: verified by the skill's own rules and added as a new proposal,
     continuing the numbering. Work the largest claimed saving first.
   - `declined`: a rule excludes it, a known disposition settled it, or the
     measurement refutes it. Give the reason and the evidence.
   - `declined: returned`: it belongs to the other audit under the hand-off
     rule. Say what shape it would take there.
   - `open`: plausible, not verified in this batch. Say what would verify it.
2. Read the other audit's ranked proposals and record every interaction with
   kind `overlap` (both remove the same statements, requests, or bytes, so
   the saving counts once), `shrinks` (one saving is smaller or earned less
   often after the other ships), `order` (one ships before or with the
   other), or `conflict`.
3. Stay inside one batch: at most one wave of three auditors on named groups
   of leads, then the coordinator's verification. Slices are not reopened.
4. Write `cross-audit.md` with the sections `Leads received`, `Interactions
   with the other audit`, and `Changes to this report`, and update the
   drafts, the checkpoint, and the receipt.

The two batches run at the same time, so a lead one audit returns arrives
after the other's batch has closed. The publisher lists returned leads as
open between the audits; a later `resume` of the receiving audit picks them
up.

## One unified issue

One session publishes: the launcher that started both coordinators, or the
session the user asked for the report. It changes nothing in a draft except
the receipt rows it reconciles and text GitHub would mislink.

- **Title:** `Efficiency audit (database and protocol): <n> proposals (<k>
  High impact)`, with the `Partial` prefix when either audit has a partial
  slice.
- **Body:** what ran and at which revision; how to read the ids and labels;
  both coverage tables; one summary table of every ranked proposal built
  from the two `proposals.json` files; the decisions needed (rulings and
  capability trades from both); the merged interaction table; the leads
  still open between the audits; cross-audit ordering and reset notes; and
  one receipt section per audit run, each inside its own run markers.
- **Comments:** each report in template order, split at heading boundaries
  into parts under GitHub's 65,536-character limit, then one comment with
  both `cross-audit.md` files. The body links each comment.

Publish and verify as the receipt guide's
[publication steps](audit-usage-receipts.md#publish-and-reconcile) say:
record `publication: pending`, create the issue with the body, read the body
back exactly, post each comment and read it back by its id, then add the
comment links with a compared edit and read the body back again. Append the
issue URL and `publication: verified` to both checkpoints.

Without a request for one report, each coordinator publishes its own issue
as its skill says, after the reconciliation batch, and each issue links the
other.
