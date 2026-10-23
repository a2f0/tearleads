# Diagnostics

Shared privacy policy, finite app activity vocabulary, and private Sentry clients.
Web, Capacitor, Electrobun, and API hosts configure their own DSNs and code-path
allowlists; this package does not import application or server implementation
code.

`browser` supplies the app diagnostics contract and browser lifecycle listeners.
`server` uses an isolated scope for each explicitly captured server error; the
API and the Electrobun main process use it. Neither client installs automatic
integrations. `privacy` reconstructs allowed error fields, and `transport`
repeats that check before sending error envelopes. API reports retain bounded,
sanitized cause stacks, database acquisition counters, and build-allowlisted
route templates. Only the API transport also emits locally constructed
aggregate discard counts; caller-supplied client reports are rejected.

See [the collection and deployment policy](../../docs/developer/sentry.md).
