# Kustomize Scaffold

This directory is a non-active scaffold for moving from direct manifest applies
to kustomize.

- `base/` includes the current core resources (excluding `secrets.yaml`).
- `overlays/staging/` composes the base for staging.

Current deploy behavior is unchanged: `scripts/deploy.sh` still applies raw
manifest files and renders ingress/issuer templates dynamically.
