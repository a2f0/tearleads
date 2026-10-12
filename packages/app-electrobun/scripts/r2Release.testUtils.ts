export const r2ReleaseStorageStub = `#!/bin/sh
[ "$1" = prod ] || [ "$1" = staging ] || exit 7
[ "$2 $3 $4" = 'output -json release_storage' ] || exit 8
printf '{"bucket":"tearleads-downloads-%s","endpoint":"https://11111111111111111111111111111111.r2.cloudflarestorage.com","access_key_id":"r2-test-key","secret_access_key":"r2-test-secret"}' "$1"
`;
