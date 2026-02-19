# Shared Tailscale Stack

This stack manages tailnet ACL policy for VPN access, with access controlled by a dedicated Tailscale ACL group.

Default policy principal:

- `group:vpn-access`

Default destination:

- `tag:vpn-gateway:*`

## Required environment variables

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `TF_VAR_tailscale_tailnet_id`
- `TF_VAR_tailscale_api_token`

Optional:

- `TF_VAR_vpn_access_group_name` (default `vpn-access`)
- `TF_VAR_vpn_access_member_emails` (default `[]`, explicit member emails for the policy group)
- `TF_VAR_vpn_gateway_tag` (default `tag:vpn-gateway`)
- `TF_VAR_create_vpn_gateway_auth_key` (default `false`)
- `TF_VAR_vpn_gateway_auth_key_expiry_seconds` (default `7776000`)
- `TF_VAR_overwrite_existing_acl` (default `true`)

## Usage

```bash
./scripts/init.sh
./scripts/plan.sh
./scripts/apply.sh
```

Wrapper:

```bash
./scripts/tf.sh init
./scripts/tf.sh plan
./scripts/tf.sh apply
```

## Notes

- `tailscale_acl` manages the full tailnet policy file.
- By default this stack sets `overwrite_existing_content=true` so first apply can replace the default policy.
- This stack locks down the VPN access group by granting it access only to `${vpn_gateway_tag}:*`.
- If you want stricter safety, set `TF_VAR_overwrite_existing_acl=false` and import first:

```bash
terraform import tailscale_acl.vpn_policy acl
```
