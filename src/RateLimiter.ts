import { Effect, Data } from "effect";

export class RateLimitExceeded extends Data.TaggedError("RateLimitExceeded")<{
  readonly clientId: string;
  readonly retryAfter?: number; // Optional: Suggest when the client can retry (in seconds)
}> {}

// Define the RateLimiter Service interface
export interface RateLimiter {
  readonly check: (clientId: string) => Effect.Effect<void, RateLimitExceeded>;
}

// Configuration for the in-memory limiter
interface InMemoryRateLimiterConfig {
  readonly windowMs: number;
  readonly maxRequests: number;
}

// Factory function to create a rate limiter instance
export const makeInMemoryRateLimiter = (
  config: InMemoryRateLimiterConfig
): RateLimiter => {
  const clientRequests = new Map<string, number[]>();

  return {
    check: (clientId: string) =>
      Effect.sync(() => {
        const now = Date.now();
        const windowStart = now - config.windowMs;

        const requests = clientRequests.get(clientId) ?? [];
        const recentRequests = requests.filter(
          (timestamp) => timestamp > windowStart
        );

        if (recentRequests.length >= config.maxRequests) {
          const oldestRequest = recentRequests.at(0);
          const retryAfter = oldestRequest
            ? Math.ceil((oldestRequest + config.windowMs - now) / 1000)
            : undefined;
          clientRequests.set(clientId, recentRequests); // Keep existing requests for retryAfter
          throw new RateLimitExceeded({ clientId, retryAfter });
        } else {
          const updatedRequests = [...recentRequests, now];
          clientRequests.set(clientId, updatedRequests);
          return; // Indicate success
        }
      }),
  };
};
