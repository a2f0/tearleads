#!/usr/bin/env bash
# Helper functions for generatePreenDocs.sh
# Sourced by generatePreenDocs.sh — do not run directly.

render_table_rows() {
  jq -r '.categories[] | "| `\(.id)` | \(.purpose) |"' "$REGISTRY_FILE"
}

render_category_array() {
  jq -r '.categories[] | "  \"\(.id)\""' "$REGISTRY_FILE"
}

render_security_category_array() {
  jq -r '.categories[] | select(.security == true) | "  \"\(.id)\""' "$REGISTRY_FILE"
}

render_discovery_case() {
  jq -r '
    .categories[]
    | "    \(.id))",
      (.discoveryCommands[] | "      " + .),
      "      ;;"
  ' "$REGISTRY_FILE"
}

render_metric_case() {
  jq -r '
    .categories[]
    | "    \(.id))",
      ((.metricCountCommands // [.metricCountCommand])[] | "      " + .),
      "      ;;"
  ' "$REGISTRY_FILE"
}

render_quality_metrics() {
  jq -r '.categories[] | "- \(.qualityMetric)"' "$REGISTRY_FILE"
}

render_checklist_rows() {
  jq -r '.categories[] | "- [ ] \(.checklistLabel)"' "$REGISTRY_FILE"
}

check_or_write_file() {
  local destination="$1"
  local content="$2"

  if [ "$MODE" = "write" ]; then
    printf '%s\n' "$content" > "$destination"
    return
  fi

  local temp_file
  temp_file="$(mktemp)"
  printf '%s\n' "$content" > "$temp_file"

  if ! diff -u "$destination" "$temp_file" >/dev/null; then
    echo "Drift detected in $destination" >&2
    diff -u "$destination" "$temp_file" >&2 || true
    rm -f "$temp_file"
    return 1
  fi

  rm -f "$temp_file"
  return 0
}
