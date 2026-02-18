---
name: preen-compliance-docs
description: Audit compliance documentation for gaps and cross-framework parity
---


# Preen Compliance Documentation

Proactively audit the `compliance/` directory structure for gaps, inconsistencies, and missing documentation across compliance frameworks (HIPAA, NIST.SP.800-53, SOC2).

## When to Run

Run this skill when maintaining compliance documentation quality or during slack time. It ensures all frameworks have consistent, complete documentation triads (policy + procedure + control map).

## Compliance Directory Structure

```text
compliance/
  infrastructure-controls.md    # Cross-framework doc (allowed at root)
  HIPAA/
    POLICY_INDEX.md
    policies/
      01-account-management-policy.md
      02-audit-logging-policy.md
    procedures/
      01-account-management-procedure.md
      02-audit-logging-procedure.md
    technical-controls/
      01-account-management-control-map.md
      02-audit-logging-control-map.md
  NIST.SP.800-53/
    (same structure)
  SOC2/
    (same structure)
```

### Root-Level Cross-Framework Documents

Some documents intentionally live at `compliance/` root because they map controls across ALL frameworks (HIPAA, NIST, SOC2) rather than belonging to a single framework:

- `infrastructure-controls.md` - Maps infrastructure sentinels to all three frameworks

These files are **allowed exceptions** to the per-framework structure. Do NOT flag them as naming violations or attempt to split them into per-framework copies.

## Discovery Phase

Search for compliance documentation gaps and inconsistencies:

```bash
# List all compliance frameworks
ls -1 compliance/ | grep -v AGENTS.md

# Count docs per framework per type
for fw in HIPAA NIST.SP.800-53 SOC2; do
  echo "=== $fw ==="
  echo "Policies: $(ls compliance/$fw/policies/*.md 2>/dev/null | wc -l | tr -d ' ')"
  echo "Procedures: $(ls compliance/$fw/procedures/*.md 2>/dev/null | wc -l | tr -d ' ')"
  echo "Controls: $(ls compliance/$fw/technical-controls/*.md 2>/dev/null | wc -l | tr -d ' ')"
done

# Find unnumbered files (naming inconsistencies)
# Excludes known root-level cross-framework docs
find compliance -name '*.md' -not -name 'POLICY_INDEX.md' -not -name 'AGENTS.md' -not -name 'infrastructure-controls.md' | xargs -I{} basename {} | grep -v '^[0-9][0-9]-' | head -20

# Find legacy redirect files (unnumbered duplicates of numbered files)
# These should be DELETED, not renamed
for fw in HIPAA NIST.SP.800-53 SOC2; do
  for type in policies procedures technical-controls; do
    for f in $(ls compliance/$fw/$type/*.md 2>/dev/null | xargs -I{} basename {} | grep -v '^[0-9][0-9]-'); do
      # Check if a numbered version exists
      topic=$(echo "$f" | sed 's/-\(policy\|procedure\|control-map\)\.md//')
      numbered=$(ls compliance/$fw/$type/[0-9][0-9]-${topic}-*.md 2>/dev/null | head -1)
      [ -n "$numbered" ] && echo "LEGACY REDIRECT: compliance/$fw/$type/$f -> $(basename $numbered)"
    done
  done
done

# Check for missing document triads (policy without procedure or control map)
for fw in HIPAA NIST.SP.800-53 SOC2; do
  for policy in $(ls compliance/$fw/policies/*.md 2>/dev/null | xargs -I{} basename {} | sed 's/-policy\.md//'); do
    proc="compliance/$fw/procedures/${policy}-procedure.md"
    ctrl="compliance/$fw/technical-controls/${policy}-control-map.md"
    [ ! -f "$proc" ] && echo "MISSING: $proc"
    [ ! -f "$ctrl" ] && echo "MISSING: $ctrl"
  done
done

# Cross-framework parity check (topics in one framework but not others)
for type in policies procedures technical-controls; do
  echo "=== $type parity ==="
  for fw in HIPAA NIST.SP.800-53 SOC2; do
    ls compliance/$fw/$type/*.md 2>/dev/null | xargs -I{} basename {} | sort
  done | sort | uniq -c | grep -v '^ *3 ' | head -10
done

# Validate POLICY_INDEX references match actual files
for fw in HIPAA NIST.SP.800-53 SOC2; do
  echo "=== $fw INDEX validation ==="
  # Extract doc references from index
  rg -o '\./[a-z-]+/[0-9a-z-]+\.md' "compliance/$fw/POLICY_INDEX.md" | while read ref; do
    [ ! -f "compliance/$fw/$ref" ] && echo "BROKEN: $ref"
  done
done
```

## Prioritization

Fix issues in this order (highest impact first):

1. **Legacy redirect files**: Unnumbered files that duplicate numbered versions - DELETE these immediately
2. **Missing document triads**: Policy exists but procedure or control map is missing
3. **Cross-framework gaps**: Topic covered in one framework but not others
4. **Broken POLICY_INDEX references**: Index lists files that don't exist
5. **Unnumbered files**: Files not following `NN-topic-*.md` naming convention (and no numbered version exists)
6. **Missing POLICY_INDEX entries**: Files exist but not listed in index

## Gap Categories

### 0. Legacy Redirect Files (DELETE immediately)

Legacy redirect files are unnumbered files that exist alongside properly numbered versions. They typically contain only a redirect notice pointing to the canonical numbered file. Per project policy on backwards-compatibility hacks, these should be **deleted**, not kept.

```bash
# Find legacy redirect files
for fw in HIPAA NIST.SP.800-53 SOC2; do
  for type in policies procedures technical-controls; do
    for f in $(ls compliance/$fw/$type/*.md 2>/dev/null | xargs -I{} basename {} | grep -v '^[0-9][0-9]-'); do
      topic=$(echo "$f" | sed 's/-\(policy\|procedure\|control-map\)\.md//')
      numbered=$(ls compliance/$fw/$type/[0-9][0-9]-${topic}-*.md 2>/dev/null | head -1)
      [ -n "$numbered" ] && echo "DELETE: compliance/$fw/$type/$f (duplicate of $(basename $numbered))"
    done
  done
done
```

**Action**: Delete the unnumbered file. Do NOT update POLICY_INDEX (it should already reference the numbered version).

### 1. Document Triad Completeness

Each compliance topic should have three documents:

- `policies/NN-topic-policy.md` - What the policy is
- `procedures/NN-topic-procedure.md` - How to implement it
- `technical-controls/NN-topic-control-map.md` - Technical implementation mapping

```bash
# Find incomplete triads
for fw in HIPAA NIST.SP.800-53 SOC2; do
  echo "=== $fw incomplete triads ==="
  for policy in $(ls compliance/$fw/policies/*.md 2>/dev/null | xargs -I{} basename {} | sed 's/-policy\.md//'); do
    proc="compliance/$fw/procedures/${policy}-procedure.md"
    ctrl="compliance/$fw/technical-controls/${policy}-control-map.md"
    missing=""
    [ ! -f "$proc" ] && missing="$missing procedure"
    [ ! -f "$ctrl" ] && missing="$missing control-map"
    [ -n "$missing" ] && echo "$policy: missing$missing"
  done
done
```

### 2. Cross-Framework Parity

All frameworks should cover the same topics. If account-management exists in HIPAA, it should exist in NIST and SOC2.

```bash
# Find parity gaps
for type in policies procedures technical-controls; do
  # Get union of all topics
  all_topics=$(for fw in HIPAA NIST.SP.800-53 SOC2; do
    ls compliance/$fw/$type/*.md 2>/dev/null | xargs -I{} basename {} | sed 's/-\(policy\|procedure\|control-map\)\.md//'
  done | sort -u)

  # Check each topic in each framework
  for topic in $all_topics; do
    for fw in HIPAA NIST.SP.800-53 SOC2; do
      suffix=""
      [ "$type" = "policies" ] && suffix="-policy.md"
      [ "$type" = "procedures" ] && suffix="-procedure.md"
      [ "$type" = "technical-controls" ] && suffix="-control-map.md"
      [ ! -f "compliance/$fw/$type/${topic}${suffix}" ] && echo "PARITY GAP: $fw/$type/${topic}${suffix}"
    done
  done
done
```

### 3. Naming Consistency

All document files within framework directories should follow numbered naming: `NN-topic-{policy|procedure|control-map}.md`

Root-level cross-framework docs (like `infrastructure-controls.md`) are excluded from this check.

```bash
# Find files not matching pattern (excludes root-level cross-framework docs)
find compliance -name '*.md' -not -name 'POLICY_INDEX.md' -not -name 'AGENTS.md' -not -path 'compliance/*.md' | while read f; do
  base=$(basename "$f")
  echo "$base" | grep -qE '^[0-9]{2}-[a-z-]+-(policy|procedure|control-map)\.md$' || echo "NAMING: $f"
done
```

### 4. POLICY_INDEX Synchronization

Each framework's `POLICY_INDEX.md` should accurately list all implemented documents.

```bash
# Check index completeness
for fw in HIPAA NIST.SP.800-53 SOC2; do
  echo "=== $fw ==="
  # Files in dirs but not in index
  for type in policies procedures technical-controls; do
    for f in $(ls compliance/$fw/$type/*.md 2>/dev/null | xargs -I{} basename {}); do
      grep -q "$f" "compliance/$fw/POLICY_INDEX.md" || echo "NOT IN INDEX: $type/$f"
    done
  done
done
```

## Creating Missing Documents

When creating missing compliance documents, use existing documents as templates:

### Policy Template Reference

```bash
# Use existing policy as template
head -50 compliance/HIPAA/policies/01-account-management-policy.md
```

### Procedure Template Reference

```bash
# Use existing procedure as template
head -50 compliance/HIPAA/procedures/01-account-management-procedure.md
```

### Control Map Template Reference

```bash
# Use existing control map as template
head -50 compliance/HIPAA/technical-controls/01-account-management-control-map.md
```

## Workflow

1. **Discovery**: Run discovery commands to identify all gaps
2. **Selection**: Choose highest-impact gap (missing triad > parity gap > naming)
3. **Create branch**: `git checkout -b docs/compliance-<topic>`
4. **Create/fix documents**: Use templates from existing docs in same framework
5. **Update POLICY_INDEX**: Add new documents to the index
6. **Validate**: Re-run discovery to confirm gap is fixed
7. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`

If no high-value gaps were found during discovery, do not create a branch or run commit/merge workflows.

## Guardrails

- Do not modify regulatory citations or official framework mappings
- Maintain consistent document structure across frameworks
- Keep document numbering sequential (01, 02, 03...)
- Ensure all cross-references are valid
- Do not create placeholder documents - each doc must have real content
- New documents should map to actual system implementations

## Quality Bar

- Zero incomplete document triads
- Full cross-framework parity for all covered topics
- All files follow naming convention
- POLICY_INDEX accurately reflects all documents
- No broken internal links

## PR Strategy

Use incremental PRs by gap type:

- PR 1: Fix naming inconsistencies
- PR 2: Complete missing document triads
- PR 3: Add cross-framework parity docs
- PR 4: Sync POLICY_INDEX files

In each PR description, include:

- What gap category was addressed
- Which frameworks/topics were affected
- Summary of new or modified documents

## Token Efficiency

Discovery commands can return many lines. Always limit output:

```bash
# Count first, then show limited results
find compliance -name '*.md' | wc -l
# Then sample specific gaps
```

## Metric Function

```bash
# Count total compliance documentation gaps
compliance_gap_count() {
  gaps=0

  # Count legacy redirect files (unnumbered duplicates - highest priority)
  for fw in HIPAA NIST.SP.800-53 SOC2; do
    for type in policies procedures technical-controls; do
      for f in $(ls compliance/$fw/$type/*.md 2>/dev/null | xargs -I{} basename {} | grep -v '^[0-9][0-9]-'); do
        topic=$(echo "$f" | sed 's/-\(policy\|procedure\|control-map\)\.md//')
        numbered=$(ls compliance/$fw/$type/[0-9][0-9]-${topic}-*.md 2>/dev/null | head -1)
        [ -n "$numbered" ] && gaps=$((gaps + 1))
      done
    done
  done

  # Count missing triads
  for fw in HIPAA NIST.SP.800-53 SOC2; do
    for policy in $(ls compliance/$fw/policies/*.md 2>/dev/null | xargs -I{} basename {} | sed 's/-policy\.md//'); do
      [ ! -f "compliance/$fw/procedures/${policy}-procedure.md" ] && gaps=$((gaps + 1))
      [ ! -f "compliance/$fw/technical-controls/${policy}-control-map.md" ] && gaps=$((gaps + 1))
    done
  done

  # Count unnumbered files in framework dirs (excludes root-level cross-framework docs)
  unnumbered=$(find compliance -name '*.md' -not -name 'POLICY_INDEX.md' -not -name 'AGENTS.md' -not -path 'compliance/*.md' | xargs -I{} basename {} | grep -v '^[0-9][0-9]-' | wc -l)
  gaps=$((gaps + unnumbered))

  echo $gaps
}

compliance_gap_count
```
