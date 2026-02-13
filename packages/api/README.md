# @tearleads/api

Express API server for the Tearleads application.

## Development

```bash
pnpm dev
```

Starts the development server with hot reloading on `http://localhost:5001`.

### Environment Variables

#### JWT Secret

Generate a JWT secret for `JWT_SECRET`.

```bash
openssl rand -hex 32
```

#### OpenRouter API Key

The `OPENROUTER_API_KEY` is required for the chat completion endpoint. You can get a key from [openrouter.ai](https://openrouter.ai/keys).

#### RevenueCat Webhook Secret

`REVENUECAT_WEBHOOK_SECRET` secures `POST /v1/revenuecat/webhooks`.
Configure this to the shared webhook signing secret from RevenueCat.

Optional replay window controls:

- `REVENUECAT_WEBHOOK_MAX_AGE_SECONDS` (default `86400`)
- `REVENUECAT_WEBHOOK_MAX_FUTURE_SKEW_SECONDS` (default `300`)

## Building

```bash
pnpm build
pnpm start
```

## API Endpoints

- `GET /v1/ping` - Health check endpoint
