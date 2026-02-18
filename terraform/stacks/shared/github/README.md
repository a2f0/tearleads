# Shared GitHub Stack

This stack manages repository-level GitHub settings for `a2f0/tearleads`.

## Merge-signing GitHub App support

The stack can optionally manage the association between a pre-existing GitHub App installation and this repository.

Important: this stack does not create the GitHub App registration or private key. Create/install the app once in GitHub first, then provide the installation ID to Terraform.

### Variables

- `enable_merge_signing_app_installation` (default: `false`)
- `merge_signing_app_installation_id` (required when enabled)
- `merge_signing_app_slug` (optional metadata lookup)
- `use_repository_ruleset_for_main` (default: `false`)
- `enable_merge_signing_bypass` (default: `false`, ruleset mode only)
- `merge_signing_app_id` (required for bypass)

Compatibility aliases are also supported:

- `tearleads_version_bumper_app_id`
- `tearleads_version_bumper_installation_id`
- `tearleads_version_bumper_app_slug`
- `tearleads_version_bumper_installatio_id` (deprecated typo alias)

Example `terraform.tfvars`:

```hcl
enable_merge_signing_app_installation = true
merge_signing_app_installation_id     = 12345678
merge_signing_app_slug                = "your-app-slug"
use_repository_ruleset_for_main       = true
enable_merge_signing_bypass           = true
merge_signing_app_id                  = 987654
```

### Safe rollout

1. Create and install the GitHub App manually (one-time bootstrap).
2. Import the existing installation-repository link if already installed:
   - `MERGE_SIGNING_APP_INSTALLATION_ID=<id> ./scripts/import.sh`
3. For ruleset migration, import existing main branch protection once:
   - `terraform -chdir=. import 'github_branch_protection.main[0]' tearleads:main`
4. Enable `use_repository_ruleset_for_main` in `terraform.tfvars`.
5. Run `./scripts/plan.sh` and confirm expected changes:
   - destroy `github_branch_protection.main[0]`
   - create `github_repository_ruleset.main[0]`
6. Run `./scripts/apply.sh`.

### Environment variable examples

Canonical:

```bash
export TF_VAR_merge_signing_app_id='2889195'
export TF_VAR_merge_signing_app_installation_id='110805914'
export TF_VAR_merge_signing_app_slug='tearleads-version-bumper'
```

Compatible aliases:

```bash
export TF_VAR_tearleads_version_bumper_app_id='2889195'
export TF_VAR_tearleads_version_bumper_installation_id='110805914'
export TF_VAR_tearleads_version_bumper_app_slug='tearleads-version-bumper'
```

### Resource managed

- `github_app_installation_repository.merge_signing` (optional)
