#!/bin/sh
set -eu
export TF_WORKSPACE="${TF_WORKSPACE_K8S:?TF_WORKSPACE_K8S is not set}"
cd "$(dirname "$0")/.."
SERVER_IP=$(terraform output -raw server_ip)
USERNAME=$(terraform output -raw server_username)
ssh "${USERNAME}@${SERVER_IP}" "sudo cat /etc/rancher/k3s/k3s.yaml" | \
  sed "s/127.0.0.1/${SERVER_IP}/g"
