# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands
- Run all tests: `bun test`
- Run a single test: `bun test src/FileName.test.ts`
- Start server: `bun run src/server.ts`

## Code Style Guidelines
- Use TypeScript with strict mode enabled
- Format: Standard ESNext, indent with 2 spaces
- Imports: Group by external/internal, alphabetize
- Types: Prefer explicit typing and interfaces
- Naming: camelCase for variables/functions, PascalCase for classes/interfaces
- Error handling: Use Effect.Effect for functional error handling
- Test coverage: Write comprehensive tests using bun:test
- Documentation: Add JSDoc for public APIs
- Effect patterns: Properly handle Effect.Effect returns and errors
- Error types: Use Data.TaggedError for custom errors
- Prefer functional style with immutable data structures