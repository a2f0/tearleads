# Shared Google Workspace Stack

This stack manages Google Workspace groups (distribution lists) only.
It does not manage group memberships.

## What this stack manages

- Creates/updates/deletes groups via `googleworkspace_group`
- Does not create `googleworkspace_group_member` resources

## Required environment variables

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `TF_VAR_googleworkspace_customer_id`

Optional:

- `TF_VAR_googleworkspace_access_token` (auto-set by scripts via `gcloud auth print-access-token`)
- `TF_VAR_googleworkspace_impersonated_user_email` (only when using service-account impersonation)
- `TF_VAR_googleworkspace_service_account` (required when impersonating)
- `TF_VAR_googleworkspace_credentials` (service account JSON when not using user OAuth)

Runtime hydration in scripts (`init.sh`, `plan.sh`, `apply.sh`):

- If `TF_VAR_googleworkspace_credentials` is unset and `.secrets/terraform-gworkspace-sa.json` exists, scripts load it automatically.
- If `.secrets/googleworkspace-admin-email` exists, scripts set `TF_VAR_googleworkspace_impersonated_user_email` from it.
- If credentials are present and `TF_VAR_googleworkspace_service_account` is unset, scripts derive it from the JSON `client_email`.
- If neither service-account credentials nor `GOOGLE_APPLICATION_CREDENTIALS` are present, scripts fall back to `gcloud auth print-access-token`.

## Configure groups

Set `TF_VAR_googleworkspace_groups` as JSON or add a `terraform.tfvars` file.

Example:

```hcl
googleworkspace_groups = {
  "all@devopsrockstars.com" = {
    name        = "All Hands"
    description = "Company-wide announcements"
  }
  "engineering@devopsrockstars.com" = {
    name        = "Engineering"
    description = "Engineering distribution list"
    aliases     = ["eng@devopsrockstars.com"]
  }
}
```

## Usage

```bash
./scripts/init.sh
./scripts/plan.sh
./scripts/apply.sh
```

or via wrapper:

```bash
./scripts/tf.sh init
./scripts/tf.sh plan
./scripts/tf.sh apply
```
