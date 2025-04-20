# Rate Limiter Demo with Effect.ts

A demonstration of a functional rate limiter implementation using Effect.ts and Bun.

## Features

- Clean functional implementation of a rate limiter using Effect.ts
- In-memory storage for client request tracking
- Configurable request windows and max requests
- REST API with proper error handling
- Interactive frontend to visualize rate limiting in action
- Proper type-safety using TypeScript

## Prerequisites

- [Bun](https://bun.sh/) 1.0.0 or higher

## Getting Started

### Installation

```bash
# Install dependencies
bun install
```

### Running the Application

Start both API and frontend servers with a single command:

```bash
bun run start
```

Or run them separately:

```bash
# Start API server on port 3000
bun run start:api

# In a separate terminal, start frontend server on port 8080
bun run start:frontend
```

Then open your browser to http://localhost:8080

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/RateLimiter.test.ts
```

## How It Works

1. The API server runs on port 3000 and requires an Authorization Bearer token
2. Each client (identified by bearer token) has a rate limit of 5 requests per 3 seconds
3. When rate limit is exceeded, the server returns a 429 response with Retry-After header
4. The frontend on port 8080 provides an interactive UI to test the rate limiter

## Implementation Details

- `RateLimiter.ts`: Core rate limiting implementation using Effect.ts
- `server.ts`: API server with CORS support and proper error handling
- `frontend.ts`: Static file server for the frontend UI
- `public/index.html`: Interactive frontend to visualize rate limiting
