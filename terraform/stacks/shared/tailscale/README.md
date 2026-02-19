# Shared Tailscale Stack

This stack manages tailnet ACL policy for VPN access using a dedicated Tailscale policy group.

Default policy:

- Source: `group:vpn-access`
- Destination: `tag:vpn-gateway:*`
- Action: `accept`

## Required environment variables

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `TF_VAR_tailscale_tailnet_id`
- `TF_VAR_tailscale_api_token`

Optional:

- `TF_VAR_vpn_access_group_name` (default `vpn-access`)
- `TF_VAR_vpn_access_member_emails` (default `[]`, explicit user emails in that policy group)
- `TF_VAR_vpn_gateway_tag` (default `tag:vpn-gateway`)
- `TF_VAR_create_vpn_gateway_auth_key` (default `false`)
- `TF_VAR_vpn_gateway_auth_key_expiry_seconds` (default `7776000`)
- `TF_VAR_overwrite_existing_acl` (default `true`)

Example:

```bash
export TF_VAR_tailscale_tailnet_id="T5HkaMFs6c11CNTRL"
export TF_VAR_tailscale_api_token="tskey-api-..."
export TF_VAR_vpn_access_group_name="vpn-access"
export TF_VAR_vpn_access_member_emails='["dan@devopsrockstars.com"]'
```

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

Import existing ACL first (optional):

```bash
./scripts/import.sh
```

## Notes

- `tailscale_acl` manages the full tailnet policy file.
- By default this stack sets `overwrite_existing_content=true` so first apply can replace the default policy.
- This stack locks down the VPN access group by granting it access only to `tag:vpn-gateway:*` (or your configured `TF_VAR_vpn_gateway_tag`).
- This is a Tailscale policy group model; it does not sync Google Workspace group membership automatically.
- If you want stricter safety, set `TF_VAR_overwrite_existing_acl=false` and import first:

```bash
terraform import tailscale_acl.vpn_policy acl
```
