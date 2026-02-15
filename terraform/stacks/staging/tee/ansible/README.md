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
./terraform/stacks/staging/tee/ansible/scripts/setup.sh
```

## Usage

Provision localhost (useful inside Packer/VM image builders):

```bash
TEE_API_BUNDLE_SRC="$(pwd)/packages/tee-api/dist/server.cjs" \
  ./terraform/stacks/staging/tee/ansible/scripts/buildApiImage.sh
```

Provision a remote builder host:

```bash
TEE_ANSIBLE_INVENTORY="builder-host," \
TEE_API_BUNDLE_SRC="$(pwd)/packages/tee-api/dist/server.cjs" \
  ./terraform/stacks/staging/tee/ansible/scripts/buildApiImage.sh
```

## Secrets

The image does not embed the signing key. At runtime, place the key at:

- `/etc/tee-api/signing-key.pem`

and keep the default env setting:

- `TEE_API_SIGNING_PRIVATE_KEY_PATH=/etc/tee-api/signing-key.pem`

### Initial Key Installation

1. Generate an Ed25519 key pair on your local machine:

```bash
openssl genpkey -algorithm Ed25519 -out signing-key.pem
openssl pkey -in signing-key.pem -pubout -out signing-key.pub
```

1. Securely transfer the private key to the VM:

```bash
scp signing-key.pem user@vm:/tmp/signing-key.pem
ssh user@vm 'sudo mv /tmp/signing-key.pem /etc/tee-api/signing-key.pem && \
  sudo chmod 600 /etc/tee-api/signing-key.pem && \
  sudo chown teeapi:teeapi /etc/tee-api/signing-key.pem'
```

1. Restart the service to load the new key:

```bash
ssh user@vm 'sudo systemctl restart tee-api'
```

1. Distribute the public key (`signing-key.pub`) to all clients that need to verify responses. Add it to the client's `trustedPublicKeys` configuration with the matching `keyId` (default: `tee-primary`).

### Key Rotation

To rotate keys with zero downtime:

1. Generate a new key pair (as shown above).

1. Add the new public key to all clients' `trustedPublicKeys` with a new `keyId` (e.g., `tee-secondary`). Deploy client updates. Both old and new keys should be trusted during the transition.

1. Deploy the new private key to the server:

```bash
scp new-signing-key.pem user@vm:/tmp/signing-key.pem
ssh user@vm 'sudo mv /tmp/signing-key.pem /etc/tee-api/signing-key.pem && \
  sudo chmod 600 /etc/tee-api/signing-key.pem && \
  sudo chown teeapi:teeapi /etc/tee-api/signing-key.pem'
```

1. Update the server's `TEE_API_SIGNING_KEY_ID` environment variable to match the new `keyId`:

```bash
ssh user@vm 'sudo sed -i "s/TEE_API_SIGNING_KEY_ID=.*/TEE_API_SIGNING_KEY_ID=tee-secondary/" /etc/tee-api/tee-api.env'
ssh user@vm 'sudo systemctl restart tee-api'
```

1. After a grace period (recommended: 1 hour), remove the old public key from all clients' `trustedPublicKeys`.

### Security Notes

- Never commit private keys to version control.
- Use secure channels (SSH, encrypted transfer) for key distribution.
- Consider using a secrets manager (e.g., Azure Key Vault, HashiCorp Vault) for production deployments.
- Monitor for failed signature verifications during rotation to detect misconfiguration.
