# TEE Infrastructure (Azure Confidential VM)

This folder contains Terraform + Ansible scaffolding for running a confidential-VM backed TEE API.

## Included

- Azure Confidential VM network and identity primitives
- Optional custom image support (`source_image_id`) for pre-baked API images
- Key Vault resources for sealed-key and attestation workflows
- Helper scripts for Terraform operations and image provisioning

## Terraform Quick Start

```bash
cd tee
./scripts/init.sh
./scripts/plan.sh \
  -var allowed_ssh_cidr="203.0.113.5/32" \
  -var ssh_public_key_file="$HOME/.ssh/id_ed25519.pub"
./scripts/apply.sh
```

### Use a Prebuilt API Image

If you build a managed image with the Ansible workflow below, pass it to Terraform:

```bash
./scripts/plan.sh \
  -var source_image_id="/subscriptions/.../resourceGroups/.../providers/Microsoft.Compute/images/tee-api-image"
```

## Build VM Image With API (Ansible)

1. Build the API bundle:

```bash
pnpm --filter @tearleads/tee-api build
pnpm --filter @tearleads/tee-api buildBundle
```

2. Install Ansible collections:

```bash
./scripts/ansible-setup.sh
```

3. Provision the image builder host (or localhost in a Packer image build):

```bash
TEE_API_BUNDLE_SRC="$(pwd)/../packages/tee-api/dist/server.cjs" \
  ./scripts/build-image.sh
```

The playbook installs the bundle at `/opt/tee-api/server.cjs`, creates `tee-api.service`, and enables it for first boot.

## Notes

- Default region is `eastus`; override with `-var azure_location=<region>`.
- Restrict SSH with `allowed_ssh_cidr`.
- The runtime signing key is intentionally not baked into images; inject `/etc/tee-api/signing-key.pem` at boot.
