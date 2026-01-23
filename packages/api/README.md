# @rapid/api

Express API server for the Rapid application.

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

## Building

```bash
pnpm build
pnpm start
```

## API Endpoints

- `GET /v1/health` - Health check endpoint
