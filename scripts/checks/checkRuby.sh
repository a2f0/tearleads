#!/usr/bin/env sh

set -eu

REPO_ROOT=$(git rev-parse --show-toplevel)

found_gemfile=0

for gemfile in "$REPO_ROOT"/packages/*/Gemfile; do
  if [ ! -f "$gemfile" ]; then
    continue
  fi

  found_gemfile=1
  package_dir=${gemfile%/Gemfile}
  package_name=${package_dir#"$REPO_ROOT"/}

  echo "Checking Ruby bundle for $package_name..."
  (
    cd "$package_dir"
    bundle check
  )

  echo "Running RuboCop for $package_name..."
  (
    cd "$package_dir"
    bundle exec rubocop
  )
done

if [ "$found_gemfile" -eq 0 ]; then
  echo "No package Gemfiles found."
fi
