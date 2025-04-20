import { Effect, Data } from "effect";
import { RedisService, RedisError } from "./RedisClient"; // Import the RedisService Tag

export class RateLimitExceeded extends Data.TaggedError("RateLimitExceeded")<{
  readonly clientId: string;
  readonly retryAfter?: number; // Optional: Suggest when the client can retry (in seconds)
}> {}

// Define the RateLimiter Service interface
export interface RateLimiter {
  // Restore RedisError to the error channel
  readonly check: (
    clientId: string
  ) => Effect.Effect<void, RateLimitExceeded | RedisError>;
}

// Configuration for the Redis limiter
interface RedisRateLimiterConfig {
  readonly windowMs: number;
  readonly maxRequests: number;
}

const getKey = (clientId: string) => `rate-limit:${clientId}`;

// Factory function returning an Effect
export const makeRedisRateLimiter = (
  config: RedisRateLimiterConfig
): Effect.Effect<RateLimiter, never, RedisService> => {
  // Use Effect.gen to structure the factory effect
  return Effect.gen(function* () {
    // --- Access RedisService from the Context ---
    yield* Effect.log("Attempting to access RedisService from context...");
    const redisService = yield* RedisService; // Access the service
    yield* Effect.log("RedisService:", redisService);

    // --- Construct the RateLimiter object ---
    const limiter: RateLimiter = {
      check: (clientId: string) =>
        Effect.gen(function* () {
          const now = Date.now();
          const windowStart = now - config.windowMs;
          const key = getKey(clientId);

          // Remove old entries
          yield* redisService.zremrangebyscore(key, 0, windowStart);

          // Count current entries
          const count = yield* redisService.zcard(key);

          if (count >= config.maxRequests) {
            // Get the oldest timestamp if limit exceeded
            const oldestResult = yield* redisService.zrange(
              key,
              0,
              0,
              "WITHSCORES"
            );
            const oldestTimestamp =
              oldestResult.length > 1 ? Number(oldestResult[1]) : null;
            const retryAfter = oldestTimestamp
              ? Math.max(
                  0,
                  Math.ceil((oldestTimestamp + config.windowMs - now) / 1000)
                )
              : undefined;
            yield* Effect.fail(new RateLimitExceeded({ clientId, retryAfter }));
          } else {
            // Add current request and set expiry if within limit
            const uniqueMember = `${now}-${Math.random()}`;
            const addCurrent = yield* redisService.zadd(key, now, uniqueMember);
            const setExpiry = yield* redisService.pexpire(
              key,
              config.windowMs + 1000
            );
            yield* Effect.void;
          }
        }),
    };

    return limiter;
  });
};

// --- In-Memory Implementation (Keep for reference or potential fallback) ---
// ... existing code ...
// Factory function to create a rate limiter instance
// export const makeInMemoryRateLimiter = (
//   config: InMemoryRateLimiterConfig
// ): RateLimiter => {
//   const clientRequests = new Map<string, number[]>();

//   return {
//     check: (clientId: string) =>
//       Effect.gen(function* () {
//         const now = Date.now();
//         const windowStart = now - config.windowMs;

//         const requests = clientRequests.get(clientId) ?? [];
//         const recentRequests = requests.filter(
//           (timestamp) => timestamp > windowStart
//         );

//         if (recentRequests.length >= config.maxRequests) {
//           const oldestRequest = recentRequests.at(0);
//           const retryAfter = oldestRequest
//             ? Math.ceil((oldestRequest + config.windowMs - now) / 1000)
//             : undefined;
//           clientRequests.set(clientId, recentRequests); // Keep existing requests for retryAfter
//           // Use yield* with Effect.fail
//           yield* Effect.fail(new RateLimitExceeded({ clientId, retryAfter }));
//         } else {
//           const updatedRequests = [...recentRequests, now];
//           clientRequests.set(clientId, updatedRequests);
//           // Use yield* with Effect.void
//           yield* Effect.void;
//         }
//       }),
//   };
// };
