# Diagnostics

Shared privacy policy, finite app activity vocabulary, and private Sentry clients.
Web, Capacitor, and API hosts configure their own DSNs and code-path allowlists;
this package does not import application or server implementation code.

`browser` supplies the app diagnostics contract and browser lifecycle listeners.
`server` uses an isolated scope for each explicitly captured server error. Neither
client installs automatic integrations. `privacy` reconstructs allowed error
fields, and `transport` repeats that check before sending only error envelopes.

See [the collection and deployment policy](../../docs/developer/sentry.md).
