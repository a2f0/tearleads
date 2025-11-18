# @rapid/api

Express API server for the Rapid application.

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

## Development

```bash
npm run dev
```

This will start the development server with hot reloading on `http://localhost:5001`.

## Building

```bash
npm run build
```

## Production

```bash
npm run build
npm start
```

## API Endpoints

- `GET /health` - Health check endpoint
