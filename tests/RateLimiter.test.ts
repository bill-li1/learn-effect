import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Exit, Context, Layer } from "effect";
import Redis from "ioredis-mock";
import {
  makeRedisRateLimiter,
  RateLimitExceeded,
  type RateLimiter,
} from "../src/RateLimiter";
import { RedisService, RedisError } from "../src/RedisClient";

describe("Redis Rate Limiter (Mocked)", () => {
  // Test layer with mock Redis
  const createTestRedisLayer = () => {
    const redis = new Redis();

    // Create a mock implementation matching RedisServiceInterface
    const mockRedisService = {
      zremrangebyscore: (
        key: string,
        min: number | string,
        max: number | string
      ) =>
        Effect.tryPromise({
          try: () => redis.zremrangebyscore(key, min, max),
          catch: (e) => new RedisError({ cause: e }),
        }),
      zcard: (key: string) =>
        Effect.tryPromise({
          try: () => redis.zcard(key),
          catch: (e) => new RedisError({ cause: e }),
        }),
      zrange: (
        key: string,
        start: number | string,
        stop: number | string,
        options?: "WITHSCORES"
      ) =>
        Effect.tryPromise({
          try: () =>
            options
              ? redis.zrange(key, start, stop, options)
              : redis.zrange(key, start, stop),
          catch: (e) => new RedisError({ cause: e }),
        }),
      zadd: (key: string, score: number, member: string) =>
        Effect.tryPromise({
          try: () => redis.zadd(key, score, member),
          catch: (e) => new RedisError({ cause: e }),
        }),
      pexpire: (key: string, milliseconds: number) =>
        Effect.tryPromise({
          try: () => redis.pexpire(key, milliseconds),
          catch: (e) => new RedisError({ cause: e }),
        }),
      // Mock quit - ioredis-mock doesn't have a functional quit that returns Promise
      quit: () => Effect.succeed(undefined),
    };

    return Layer.succeed(
      RedisService,
      mockRedisService // Provide the mock implementation
    );
  };

  // Test configuration
  const testConfig = {
    windowMs: 500, // 500ms window
    maxRequests: 2, // Allow 2 requests per window
  };

  test("allows requests within rate limit", async () => {
    // Create test layer with isolated Redis mock
    const testLayer = createTestRedisLayer();

    // Run the test
    await Effect.runPromise(
      Effect.gen(function* () {
        // Get the limiter instance
        const limiter = yield* makeRedisRateLimiter(testConfig);

        // First request should succeed
        yield* limiter.check("test-client-1");

        // Second request should succeed
        yield* limiter.check("test-client-1");
      }).pipe(Effect.provide(testLayer))
    );
  });

  test("rejects requests that exceed rate limit", async () => {
    const clientId = "test-client-2";
    const testLayer = createTestRedisLayer();

    // Run the test
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const limiter = yield* makeRedisRateLimiter(testConfig);

        // First two requests should succeed
        yield* limiter.check(clientId);
        yield* limiter.check(clientId);

        // Third request should fail with RateLimitExceeded
        yield* limiter.check(clientId);
      }).pipe(Effect.provide(testLayer))
    );

    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(result.cause._tag).toBe("Fail");
      if (result.cause._tag === "Fail") {
        const error = result.cause.error;
        expect(error).toBeInstanceOf(RateLimitExceeded);
        if (error instanceof RateLimitExceeded) {
          expect(error.clientId).toBe(clientId);
          // Check if retryAfter is a number (it should be in this case)
          expect(typeof error.retryAfter).toBe("number");
          expect(error.retryAfter).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test("allows requests after window expires", async () => {
    const clientId = "test-client-3";
    const testLayer = createTestRedisLayer();

    // Run the test in parts
    await Effect.runPromise(
      Effect.gen(function* () {
        const limiter = yield* makeRedisRateLimiter(testConfig);

        // First two requests should succeed
        yield* limiter.check(clientId);
        yield* limiter.check(clientId);

        // Third should fail immediately after
        const checkResult = yield* Effect.exit(limiter.check(clientId));
        expect(Exit.isFailure(checkResult)).toBe(true);

        // Wait for window to expire (500ms + buffer)
        yield* Effect.sleep(510);

        // Should allow request after window expires
        yield* limiter.check(clientId);
      }).pipe(Effect.provide(testLayer))
    );
  });

  test("limits are applied per client", async () => {
    const clientA = "test-client-5a";
    const clientB = "test-client-5b";
    const testLayer = createTestRedisLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const limiter = yield* makeRedisRateLimiter(testConfig);

        // Use up limits for clientA
        yield* limiter.check(clientA);
        yield* limiter.check(clientA);

        // ClientB should still be able to make requests
        yield* limiter.check(clientB);
        yield* limiter.check(clientB);

        // But clientA should be blocked
        const resultA = yield* Effect.exit(limiter.check(clientA));
        expect(Exit.isFailure(resultA)).toBe(true);
        if (Exit.isFailure(resultA) && resultA.cause._tag === "Fail") {
          const error = resultA.cause.error;
          expect(error).toBeInstanceOf(RateLimitExceeded);
          if (error instanceof RateLimitExceeded) {
            expect(error.clientId).toBe(clientA);
          }
        }

        // And clientB should be blocked now too
        const resultB = yield* Effect.exit(limiter.check(clientB));
        expect(Exit.isFailure(resultB)).toBe(true);
        if (Exit.isFailure(resultB) && resultB.cause._tag === "Fail") {
          const error = resultB.cause.error;
          expect(error).toBeInstanceOf(RateLimitExceeded);
          if (error instanceof RateLimitExceeded) {
            expect(error.clientId).toBe(clientB);
          }
        }
      }).pipe(Effect.provide(testLayer))
    );
  });

  test("sliding window behavior works correctly", async () => {
    const clientId = "test-client-6";
    const halfWindow = 260; // Just over half the window time
    const testLayer = createTestRedisLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const limiter = yield* makeRedisRateLimiter(testConfig);

        // First request
        const t1 = Date.now();
        yield* limiter.check(clientId);

        // Wait for half the window
        yield* Effect.sleep(halfWindow);

        // Second request
        const t2 = Date.now();
        yield* limiter.check(clientId);

        // Wait for the first request to expire (but second is still valid)
        // Wait until 510ms after the *first* request
        const waitTime1 = Math.max(0, 510 - (Date.now() - t1));
        yield* Effect.sleep(waitTime1);

        // This should succeed because the first request has expired
        const t3 = Date.now();
        yield* limiter.check(clientId);

        // But this should fail because requests at t2 and t3 are still in the window
        const result = yield* Effect.exit(limiter.check(clientId));
        expect(Exit.isFailure(result)).toBe(true);

        // Wait until the second request (t2) expires
        const waitTime2 = Math.max(0, 510 - (Date.now() - t2));
        yield* Effect.sleep(waitTime2);

        // Now a request should succeed again
        yield* limiter.check(clientId);
      }).pipe(Effect.provide(testLayer))
    );
  });

  test("handles many rapid requests correctly", async () => {
    const clientId = "test-client-7";
    const testLayer = createTestRedisLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        // Create a specific limiter instance for this test
        const limiter = yield* makeRedisRateLimiter({
          windowMs: 500,
          maxRequests: 5,
        });

        // Make 5 requests SEQUENTIALLY to ensure predictable state
        for (let i = 0; i < 5; i++) {
          yield* limiter.check(clientId);
        }

        // But the 6th should fail
        const result = yield* Effect.exit(limiter.check(clientId));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result) && result.cause._tag === "Fail") {
          const error = result.cause.error;
          expect(error).toBeInstanceOf(RateLimitExceeded);
        }
      }).pipe(Effect.provide(testLayer))
    );
  });

  test("respects windowMs configuration", async () => {
    const clientId = "test-client-8";
    const testLayer = createTestRedisLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        // Create a specific limiter instance for this test
        const limiter = yield* makeRedisRateLimiter({
          windowMs: 1000, // 1 second
          maxRequests: 1,
        });

        // First request should succeed
        yield* limiter.check(clientId);

        // Second request should fail immediately after
        const result = yield* Effect.exit(limiter.check(clientId));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result) && result.cause._tag === "Fail") {
          const error = result.cause.error;
          expect(error).toBeInstanceOf(RateLimitExceeded);
        }

        // Wait for the window to expire (1000ms + buffer)
        yield* Effect.sleep(1010);

        // Should allow request after window expires
        yield* limiter.check(clientId);
      }).pipe(Effect.provide(testLayer))
    );
  });

  test("calculates retryAfter correctly", async () => {
    const clientId = "test-client-9";
    const testLayer = createTestRedisLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        // Create a specific limiter instance for this test
        const limiter = yield* makeRedisRateLimiter({
          windowMs: 1000, // 1 second window
          maxRequests: 1,
        });

        const startTime = Date.now();
        yield* limiter.check(clientId);

        // Second request should fail
        const result = yield* Effect.exit(limiter.check(clientId));

        expect(Exit.isFailure(result)).toBe(true);
        let retryAfterVal;

        if (Exit.isFailure(result) && result.cause._tag === "Fail") {
          const error = result.cause.error;
          expect(error).toBeInstanceOf(RateLimitExceeded);
          if (error instanceof RateLimitExceeded) {
            expect(error.clientId).toBe(clientId);
            retryAfterVal = error.retryAfter;
            const expectedRetryAfter = Math.max(
              0,
              Math.ceil((startTime + 1000 - Date.now()) / 1000)
            );
            // Allow for slight timing differences (e.g., +/- 1 second)
            expect(error.retryAfter).toBeGreaterThanOrEqual(
              expectedRetryAfter - 1
            );
            expect(error.retryAfter).toBeLessThanOrEqual(
              expectedRetryAfter + 1
            ); // Usually 1 or 0
          }
        }

        // Wait for calculated retryAfter time
        const retryAfterMs = retryAfterVal ? retryAfterVal * 1000 : 1010;
        yield* Effect.sleep(retryAfterMs + 10); // +10ms buffer

        // Request should now succeed
        yield* limiter.check(clientId);
      }).pipe(Effect.provide(testLayer))
    );
  });
});
