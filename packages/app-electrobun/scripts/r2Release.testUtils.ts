export const r2ReleaseStorageStub = `#!/bin/sh
[ "$1" = prod ] || [ "$1" = staging ] || exit 7
[ "$2 $3 $4" = 'output -json release_storage' ] || exit 8
bucket="tearleads-downloads-$1"
endpoint=https://11111111111111111111111111111111.r2.cloudflarestorage.com
key=r2-test-key
case "$RELEASE_TEST_FAILURE" in
  storage-read) exit 9 ;;
  storage-bucket) bucket=unexpected-bucket ;;
  storage-endpoint) endpoint=https://s3.amazonaws.com ;;
  storage-key) key= ;;
esac
printf '{"bucket":"%s","endpoint":"%s","access_key_id":"%s","secret_access_key":"r2-test-secret"}' "$bucket" "$endpoint" "$key"
`;

export const r2ReleaseCredentialProbe = `
[ "$AWS_ACCESS_KEY_ID" = r2-test-key ] && [ "$AWS_SECRET_ACCESS_KEY" = r2-test-secret ] || exit 91
[ -z "$AWS_SESSION_TOKEN" ] && [ -z "$AWS_SECURITY_TOKEN" ] || exit 92
[ -z "$AWS_PROFILE" ] && [ -z "$AWS_DEFAULT_PROFILE" ] || exit 93
[ "$AWS_REQUEST_CHECKSUM_CALCULATION" = when_required ] && [ "$AWS_RESPONSE_CHECKSUM_VALIDATION" = when_required ] || exit 94
`;

export const r2ReleaseAmbientCredentials = {
  AWS_ACCESS_KEY_ID: "inherited-key",
  AWS_SECRET_ACCESS_KEY: "inherited-secret",
  AWS_SESSION_TOKEN: "inherited-session",
  AWS_SECURITY_TOKEN: "inherited-security-token",
  AWS_PROFILE: "inherited-profile",
  AWS_DEFAULT_PROFILE: "inherited-default-profile",
  AWS_REQUEST_CHECKSUM_CALCULATION: "when_supported",
  AWS_RESPONSE_CHECKSUM_VALIDATION: "when_supported",
};
