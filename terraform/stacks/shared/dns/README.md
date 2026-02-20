# Shared DNS Stack (Cloudflare)

This stack manages apex DNS records for `tearleads.com` in Cloudflare.

Current scope:

- Google Workspace MX records
- Google site verification TXT records

## Prerequisites

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `TF_VAR_cloudflare_api_token`
- `TF_VAR_cloudflare_account_id`

Optional:

- `TF_VAR_dns_domain` (defaults to `tearleads.com`)

## Usage

```bash
./scripts/init.sh
./scripts/plan.sh
./scripts/apply.sh
```

Or:

```bash
./scripts/tf.sh init
./scripts/tf.sh plan
./scripts/tf.sh apply
```

## Import Existing Cloudflare Records

Use imports to adopt existing live records into Terraform state (no DNS changes).

1. Initialize:

```bash
./scripts/init.sh
```

1. Set helpers:

```bash
ZONE_NAME="${TF_VAR_dns_domain:-tearleads.com}"
ACCOUNT_ID="$TF_VAR_cloudflare_account_id"
TOKEN="$TF_VAR_cloudflare_api_token"

ZONE_ID=$(curl -sS -X GET \
  "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}&account.id=${ACCOUNT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | jq -r '.result[0].id')
```

1. List current MX/TXT records and IDs (for verification):

```bash
curl -sS -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?per_page=500" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | \
  jq -r --arg zone "$ZONE_NAME" '
    .result[]
    | select(.name == $zone and (.type == "MX" or .type == "TXT"))
    | [.id, .type, (.priority // ""), .content]
    | @tsv
  '
```

1. Import expected MX records:

```bash
terraform -chdir=. import 'cloudflare_record.mx["1-aspmx.l.google.com."]' "${ZONE_ID}/<MX_RECORD_ID_FOR_1_ASPMX>"
terraform -chdir=. import 'cloudflare_record.mx["5-alt1.aspmx.l.google.com."]' "${ZONE_ID}/<MX_RECORD_ID_FOR_5_ALT1>"
terraform -chdir=. import 'cloudflare_record.mx["5-alt2.aspmx.l.google.com."]' "${ZONE_ID}/<MX_RECORD_ID_FOR_5_ALT2>"
terraform -chdir=. import 'cloudflare_record.mx["10-aspmx2.googlemail.com."]' "${ZONE_ID}/<MX_RECORD_ID_FOR_10_ASPMX2>"
terraform -chdir=. import 'cloudflare_record.mx["10-aspmx3.googlemail.com."]' "${ZONE_ID}/<MX_RECORD_ID_FOR_10_ASPMX3>"
```

1. Import expected TXT Google verification records:

```bash
terraform -chdir=. import 'cloudflare_record.google_site_verification["google-site-verification=-U0LmlFws7EMjM8T1_HE3JFm1yrPFBscL-MT2n7y9RY"]' "${ZONE_ID}/<TXT_RECORD_ID_FOR_U0LmlF...>"
terraform -chdir=. import 'cloudflare_record.google_site_verification["google-site-verification=nIgRjHZv6Eaf78a8KhqGk7lJsBUndJBNoioOYluKsbo"]' "${ZONE_ID}/<TXT_RECORD_ID_FOR_nIgRjH...>"
```

1. Verify:

```bash
./scripts/plan.sh
```

Expected result after correct import: no changes for managed MX/TXT records.

## Notes

- This stack intentionally does not manage CAA records yet. Existing live CAA policy should stay unchanged.
- If you later decide to manage CAA here, import first and then apply.
