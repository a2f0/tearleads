# Hosting browser SDK clients

Set `apiBaseUrl` to the API your host uses. Hosted Tearleads APIs allow CORS from
every origin, including new SDK hosts without a server configuration change.
Requests authenticate with bearer tokens and retain the signed protocol's
verification requirements.

Browser requests must not use cookie credentials (`credentials: "include"`).
The API returns `Access-Control-Allow-Origin: *` without
`Access-Control-Allow-Credentials`. It explicitly allows the authorization,
content-type, and protocol request headers and exposes protocol response headers,
including the API build version.

Stripe checkout and portal return URLs require approval in the API's separate
`API_BILLING_RETURN_ORIGINS` allowlist. API access from an SDK host does not make
that host an approved billing redirect target. Use an approved return page or
have the API operator configure your origin before starting hosted checkout.

The deployment script derives billing origins from each tier's app and demo
hosts and the native app loopback origins. An explicit comma-separated
`API_BILLING_RETURN_ORIGINS` setting replaces those defaults; wildcards and URLs
with paths are rejected before deployment. Local servers default to an empty
billing return list, so local hosted checkout also needs explicit configuration.
