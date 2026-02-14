# Tee API Image Provisioning (Ansible)

This Ansible setup provisions a base Linux image with `tee-api` preinstalled and a hardened systemd service.

## What It Does

- Installs Node.js runtime (NodeSource)
- Creates dedicated `teeapi` service user/group
- Installs bundled API binary to `/opt/tee-api/server.cjs`
- Installs `/etc/tee-api/tee-api.env` and `tee-api.service`
- Enables `tee-api` service for first boot

## Prerequisites

1. Build the API bundle:

```bash
pnpm --filter @tearleads/tee-api build
pnpm --filter @tearleads/tee-api buildBundle
```

1. Install required collections:

```bash
./tee/ansible/scripts/setup.sh
```

## Usage

Provision localhost (useful inside Packer/VM image builders):

```bash
TEE_API_BUNDLE_SRC="$(pwd)/packages/tee-api/dist/server.cjs" \
  ./tee/ansible/scripts/buildApiImage.sh
```

Provision a remote builder host:

```bash
TEE_ANSIBLE_INVENTORY="builder-host," \
TEE_API_BUNDLE_SRC="$(pwd)/packages/tee-api/dist/server.cjs" \
  ./tee/ansible/scripts/buildApiImage.sh
```

## Secrets

The image does not embed the signing key. At runtime, place the key at:

- `/etc/tee-api/signing-key.pem`

and keep the default env setting:

- `TEE_API_SIGNING_PRIVATE_KEY_PATH=/etc/tee-api/signing-key.pem`
