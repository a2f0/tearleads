#!/usr/bin/env sh

set -eu

if [ "${1:-}" = -version ]; then
  printf 'openjdk version "%s"\n' "${FAKE_JAVA_VERSION:-25.0.4.1}" >&2
  exit 0
fi

: "${FAKE_JAVA_LOG:?}"

model_path=
config_path=
metadir_path=
tmpdir_path=
hosts_path=

while [ "$#" -gt 0 ]; do
  case "$1" in
    -config)
      shift
      config_path=${1:-}
      ;;
    -metadir)
      shift
      metadir_path=${1:-}
      ;;
    -Djava.io.tmpdir=*) tmpdir_path=${1#-Djava.io.tmpdir=} ;;
    -Djdk.net.hosts.file=*) hosts_path=${1#-Djdk.net.hosts.file=} ;;
    *.tla) model_path=$1 ;;
  esac
  shift
done

[ -n "$model_path" ] || exit 2
[ -n "$config_path" ] || exit 2
[ -n "$metadir_path" ] || exit 2
# Real SANY writes standard modules into java.io.tmpdir, so it must exist.
[ -d "$tmpdir_path" ] || exit 2
# Real TLC resolves this host's name, which must not reach the system resolver.
grep -q " $(hostname) " "$hosts_path" 2>/dev/null || exit 2

printf '%s|%s|%s|%s|%s\n' "$model_path" "$config_path" "$metadir_path" "$tmpdir_path" "$$" >>"$FAKE_JAVA_LOG"

# A long model: keep this PID alive without reacting to SIGINT, as TLC does in a
# background job.
if [ -n "${FAKE_JAVA_HANG:-}" ]; then
  exec sleep 60
fi

# Real TLC prints its search, any trace, then a verdict and summary lines.
echo "fake-tlc trace line for $config_path"
if [ "${FAKE_FAIL_CONFIG:-}" = "$config_path" ] ||
  [ "${FAKE_FAIL_MODEL:-}" = "$model_path" ]; then
  echo "Error: Invariant FakeInvariant is violated."
  exit "${FAKE_FAIL_STATUS:-1}"
fi
echo "Model checking completed. No error has been found."
echo "4 states generated, 3 distinct states found, 0 states left on queue."
echo "The depth of the complete state graph search is 2."
echo "Finished in 00s at (fake)"
