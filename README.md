# Rapid Monorepo

A monorepo containing shared code, an Express API, and a React client application.

## Project Structure

```
rapid/
├── packages/
│   ├── shared/         # Shared TypeScript types and utilities
│   ├── api/            # Express API server
│   └── client/         # React client application
├── package.json        # Root package.json with workspace configuration
└── tsconfig.json       # Root TypeScript configuration
```

## Packages

### @rapid/shared
Shared TypeScript types and utility functions used across the monorepo.

### @rapid/api
Express API server that provides RESTful endpoints.

### @rapid/client
React client application built with Vite.

## Getting Started

### Installation

Install all dependencies across all packages:

```bash
npm install
```

This will automatically build the shared package (`@rapid/shared`) via the postinstall script.

### Development

Run all packages in development mode (runs both API and client in parallel):

```bash
npm run dev
```

This will build the shared packages first, then start both the API and client servers concurrently with labeled, colored output.

Or run individual packages:

```bash
# API server only
npm run dev:api

# Client app only
npm run dev:client
```

The API will run on `http://localhost:5001` and the client on `http://localhost:3000`.

### Building

Build all packages:

```bash
npm run build
```

Build only shared packages (required for API and client to work):

```bash
npm run build:shared
```

Or build individual packages:

```bash
# Build shared
npm run build -w @rapid/shared

# Build API
npm run build -w @rapid/api

# Build client
npm run build -w @rapid/client
```

### Testing

Run tests across all packages:

```bash
npm test
```

### Cleaning

Clean build artifacts:

```bash
npm run clean
```

## Workspace Commands

You can run commands in specific workspaces using the `-w` flag:

```bash
# Install a dependency in a specific package
npm install express -w @rapid/api

# Run a script in a specific package
npm run dev -w @rapid/client
```

## Inter-package Dependencies

Packages can depend on each other using the workspace protocol:

```json
{
  "dependencies": {
    "@rapid/shared": "*"
  }
}
```

## Development Workflow

1. Make changes to the shared package (`@rapid/shared`)
2. Build the shared package if needed: `npm run build:shared`
3. The API and client will automatically use the updated package
4. Run tests to ensure everything works

## License

Unlicensed
