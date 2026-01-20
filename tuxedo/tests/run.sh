#!/bin/sh
set -eu

TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)

failed=0
for test_file in "$TEST_DIR"/*.test.sh; do
    echo "Running $(basename "$test_file")"
    if ! sh "$test_file"; then
        failed=1
    fi
done

if [ "$failed" -ne 0 ]; then
    echo "One or more tests failed" >&2
    exit 1
fi

echo "All tuxedo tests passed"
