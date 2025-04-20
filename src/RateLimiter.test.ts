import { describe, test, expect } from "bun:test";
import { Effect, Exit, Cause, Chunk } from "effect";
import { makeInMemoryRateLimiter, RateLimitExceeded } from "./RateLimiter";

describe("Rate Limiter", () => {
  // Create a test limiter with short window for testing
  const testLimiter = makeInMemoryRateLimiter({
    windowMs: 500, // 500ms window
    maxRequests: 2, // Allow 2 requests per window
  });

  test("allows requests within rate limit", async () => {
    // First request should succeed
    expect(
      Effect.runPromise(testLimiter.check("test-client-1"))
    ).resolves.toBeUndefined();

    // Second request should succeed
    expect(
      Effect.runPromise(testLimiter.check("test-client-1"))
    ).resolves.toBeUndefined();
  });

  test("rejects requests that exceed rate limit", async () => {
    const clientId = "test-client-2";

    // First two requests should succeed
    await Effect.runPromise(testLimiter.check(clientId));
    await Effect.runPromise(testLimiter.check(clientId));

    // Third request should fail with RateLimitExceeded
    const result = await Effect.runPromiseExit(testLimiter.check(clientId));

    // Properly check the Exit result
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(Cause.isDie(result.cause)).toBe(true);
      if (Cause.isDie(result.cause)) {
        // Extract defect using Cause.defects
        const defects = Cause.defects(result.cause);
        expect(Chunk.size(defects)).toBe(1);
        // Convert Chunk to array to access element
        const error = Chunk.toReadonlyArray(defects)[0];
        expect(error).toBeInstanceOf(RateLimitExceeded);
        // Add type check for safety before accessing properties
        if (error instanceof RateLimitExceeded) {
          expect(error.clientId).toBe(clientId);
        } else {
          // Fail test if type assertion fails
          expect(error).toBeInstanceOf(RateLimitExceeded);
        }
      }
    }
  });

  test("allows requests after window expires", async () => {
    const clientId = "test-client-3";

    // First two requests should succeed
    await Effect.runPromise(testLimiter.check(clientId));
    await Effect.runPromise(testLimiter.check(clientId));

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 510));

    // Should allow request after window expires
    expect(
      Effect.runPromise(testLimiter.check(clientId))
    ).resolves.toBeUndefined();
  });

  test("verifies error is from RateLimitExceeded", async () => {
    const clientId = "test-client-4";

    // Use up the limit
    await Effect.runPromise(testLimiter.check(clientId));
    await Effect.runPromise(testLimiter.check(clientId));

    // Third request should fail with RateLimitExceeded
    const result = await Effect.runPromiseExit(testLimiter.check(clientId));

    // Properly check the Exit result
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(Cause.isDie(result.cause)).toBe(true);
      if (Cause.isDie(result.cause)) {
        // Extract defect using Cause.defects
        const defects = Cause.defects(result.cause);
        expect(Chunk.size(defects)).toBe(1);
        // Convert Chunk to array to access element
        const error = Chunk.toReadonlyArray(defects)[0];
        expect(error).toBeInstanceOf(RateLimitExceeded);
        if (error instanceof RateLimitExceeded) {
          expect(error.clientId).toBe(clientId);
        } else {
          expect(error).toBeInstanceOf(RateLimitExceeded);
        }
      }
    }
  });

  test("limits are applied per client", async () => {
    const clientA = "test-client-5a";
    const clientB = "test-client-5b";

    // Use up limits for clientA
    await Effect.runPromise(testLimiter.check(clientA));
    await Effect.runPromise(testLimiter.check(clientA));

    // ClientB should still be able to make requests
    expect(
      Effect.runPromise(testLimiter.check(clientB))
    ).resolves.toBeUndefined();

    expect(
      Effect.runPromise(testLimiter.check(clientB))
    ).resolves.toBeUndefined();

    // But clientA should be blocked
    const resultA = await Effect.runPromiseExit(testLimiter.check(clientA));

    // Properly check the Exit result
    expect(Exit.isFailure(resultA)).toBe(true);
    if (Exit.isFailure(resultA)) {
      expect(Cause.isDie(resultA.cause)).toBe(true);
      if (Cause.isDie(resultA.cause)) {
        // Extract defect using Cause.defects
        const defects = Cause.defects(resultA.cause);
        expect(Chunk.size(defects)).toBe(1);
        // Convert Chunk to array to access element
        const error = Chunk.toReadonlyArray(defects)[0];
        expect(error).toBeInstanceOf(RateLimitExceeded);
        if (error instanceof RateLimitExceeded) {
          expect(error.clientId).toBe(clientA);
        } else {
          expect(error).toBeInstanceOf(RateLimitExceeded);
        }
      }
    }
  });

  test("sliding window behavior works correctly", async () => {
    const clientId = "test-client-6";
    const halfWindow = 260; // Just over half the window time

    // First request
    await Effect.runPromise(testLimiter.check(clientId));

    // Wait for half the window to expire
    await new Promise((resolve) => setTimeout(resolve, halfWindow));

    // Second request
    await Effect.runPromise(testLimiter.check(clientId));

    // Wait for the first request to expire (but second is still valid)
    await new Promise((resolve) => setTimeout(resolve, halfWindow));

    // This should succeed because the first request has expired
    expect(
      Effect.runPromise(testLimiter.check(clientId))
    ).resolves.toBeUndefined();

    // But this should fail because we now have 2 valid requests again
    const result = await Effect.runPromiseExit(testLimiter.check(clientId));

    // Properly check the Exit result
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(Cause.isDie(result.cause)).toBe(true);
      if (Cause.isDie(result.cause)) {
        // Extract defect using Cause.defects
        const defects = Cause.defects(result.cause);
        expect(Chunk.size(defects)).toBe(1);
        // Convert Chunk to array to access element
        const error = Chunk.toReadonlyArray(defects)[0];
        expect(error).toBeInstanceOf(RateLimitExceeded);
        if (error instanceof RateLimitExceeded) {
          expect(error.clientId).toBe(clientId);
        } else {
          expect(error).toBeInstanceOf(RateLimitExceeded);
        }
      }
    }
  });

  test("handles many rapid requests correctly", async () => {
    const clientId = "test-client-7";
    const manyRateLimiter = makeInMemoryRateLimiter({
      windowMs: 500,
      maxRequests: 5,
    });

    // Make 5 requests in rapid succession
    const promises = Array(5)
      .fill(0)
      .map(() => Effect.runPromise(manyRateLimiter.check(clientId)));

    // All should resolve
    expect(Promise.all(promises)).resolves.toBeDefined();

    // But the 6th should fail
    const result = await Effect.runPromiseExit(manyRateLimiter.check(clientId));

    // Properly check the Exit result
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(Cause.isDie(result.cause)).toBe(true);
      if (Cause.isDie(result.cause)) {
        // Extract defect using Cause.defects
        const defects = Cause.defects(result.cause);
        expect(Chunk.size(defects)).toBe(1);
        // Convert Chunk to array to access element
        const error = Chunk.toReadonlyArray(defects)[0];
        expect(error).toBeInstanceOf(RateLimitExceeded);
        if (error instanceof RateLimitExceeded) {
          expect(error.clientId).toBe(clientId);
        } else {
          expect(error).toBeInstanceOf(RateLimitExceeded);
        }
      }
    }
  });

  test("respects windowMs configuration", async () => {
    const testLimiter1s = makeInMemoryRateLimiter({
      windowMs: 1000, // 1 second
      maxRequests: 1,
    });

    const clientId = "test-client-8";

    // First request should succeed
    await Effect.runPromise(testLimiter1s.check(clientId));

    // Second request should fail
    const result = await Effect.runPromiseExit(testLimiter1s.check(clientId));

    // Properly check the Exit result
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(Cause.isDie(result.cause)).toBe(true);
      if (Cause.isDie(result.cause)) {
        // Extract defect using Cause.defects
        const defects = Cause.defects(result.cause);
        expect(Chunk.size(defects)).toBe(1);
        // Convert Chunk to array to access element
        const error = Chunk.toReadonlyArray(defects)[0];
        expect(error).toBeInstanceOf(RateLimitExceeded);
        if (error instanceof RateLimitExceeded) {
          expect(error.clientId).toBe(clientId);
        } else {
          expect(error).toBeInstanceOf(RateLimitExceeded);
        }
      }
    }

    // Wait for the window to expire
    await new Promise((resolve) => setTimeout(resolve, 1010));

    // Should allow request after window expires
    expect(
      Effect.runPromise(testLimiter1s.check(clientId))
    ).resolves.toBeUndefined();
  });
});
