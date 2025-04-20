import { Context, Effect, Layer, Data } from "effect";
import Redis from "ioredis";

// Define a specific error for Redis operations
export class RedisError extends Data.TaggedError("RedisError")<{
  readonly cause: unknown;
}> {}

// Define the new Service interface with effectful methods
interface RedisServiceInterface {
  readonly zremrangebyscore: (
    key: string,
    min: number | string,
    max: number | string
  ) => Effect.Effect<number, RedisError>;
  readonly zcard: (key: string) => Effect.Effect<number, RedisError>;
  readonly zrange: (
    key: string,
    start: number | string,
    stop: number | string,
    options?: "WITHSCORES"
  ) => Effect.Effect<string[], RedisError>;
  readonly zadd: (
    key: string,
    score: number,
    member: string
  ) => Effect.Effect<number | string, RedisError>; // ioredis types can return string
  readonly pexpire: (
    key: string,
    milliseconds: number
  ) => Effect.Effect<number, RedisError>;
  readonly quit: () => Effect.Effect<void, RedisError>; // Added quit method
}

// Update the Service Tag definition to use the new interface
export class RedisService extends Context.Tag("RedisService")<
  RedisService, // Identifier type
  RedisServiceInterface // The shape of the service provided by this tag
>() {}

export const RedisClientLive = Layer.scoped(
  RedisService, // The Tag this layer provides
  Effect.acquireRelease(
    // Effect to acquire the resource (create the client and the service implementation)
    Effect.sync(() => {
      console.log("Acquiring Redis client...");
      const redis = new Redis(); // Actual ioredis client instance
      redis.on("error", (error) => {
        console.error("Redis layer connection error:", error);
      });
      redis.on("connect", () => {
        console.log("Redis client connected (via layer).");
      });

      // --- Implement the RedisServiceInterface using the 'redis' instance --- //
      const serviceImplementation: RedisServiceInterface = {
        zremrangebyscore: (key, min, max) =>
          Effect.tryPromise({
            try: () => redis.zremrangebyscore(key, min, max),
            catch: (e) => new RedisError({ cause: e }),
          }),
        zcard: (key) =>
          Effect.tryPromise({
            try: () => redis.zcard(key),
            catch: (e) => new RedisError({ cause: e }),
          }),
        zrange: (key, start, stop, options) =>
          Effect.tryPromise({
            try: () =>
              options
                ? redis.zrange(key, start, stop, options)
                : redis.zrange(key, start, stop),
            catch: (e) => new RedisError({ cause: e }),
          }),
        zadd: (key, score, member) =>
          Effect.tryPromise({
            try: () => redis.zadd(key, score, member),
            catch: (e) => new RedisError({ cause: e }),
          }),
        pexpire: (key, milliseconds) =>
          Effect.tryPromise({
            try: () => redis.pexpire(key, milliseconds),
            catch: (e) => new RedisError({ cause: e }),
          }),
        quit: () =>
          Effect.tryPromise({
            try: async () => {
              // ioredis quit() returns a Promise<"OK">, we want Effect<void>
              await redis.quit();
              return undefined; // Explicitly return void/undefined on success
            },
            catch: (e) => new RedisError({ cause: e }),
          }),
      };
      return serviceImplementation; // Return the fully implemented service object
    }),
    // Effect to release the resource
    (
      service // The acquired service object (RedisServiceInterface)
    ) =>
      service.quit().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            console.log("Redis client released via service.quit().");
          })
        ),
        // Ignore errors during quit, but log them
        Effect.catchAll((error) =>
          Effect.sync(() =>
            console.error("Error releasing Redis client:", error)
          )
        ),
        Effect.ignore // Ensure the release effect is infallible
      )
  )
);
