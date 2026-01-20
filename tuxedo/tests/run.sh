#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
TEST_SHELL="${TUXEDO_TEST_SHELL:-sh}"

if ! command -v -- "$TEST_SHELL" >/dev/null 2>&1; then
    echo "Test shell not found: $TEST_SHELL" >&2
    exit 1
fi

failed=0
for test_file in "$TEST_DIR"/*.test.sh; do
    echo "Running $(basename "$test_file")"
    if ! "$TEST_SHELL" "$test_file"; then
        failed=1
    fi
done

if [ "$failed" -ne 0 ]; then
    echo "One or more tests failed" >&2
    exit 1
fi

echo "All tuxedo tests passed"
