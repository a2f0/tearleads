# shellcheck shell=sh
# TLC gates the protocol contract, but the GitHub release publishes no digest
# and mise records no checksum for this asset, so the jar bytes are pinned
# here, shared by checkProtocolModels.sh and the protocol trace generator
# (scripts/tlcTools.ts parses this file for the trace tooling). Update the
# pin only for an intentional TLA+ tools upgrade.
export TLA_TOOLS_JAR_SHA256_PIN=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
