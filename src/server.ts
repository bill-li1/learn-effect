import { serve } from "bun";
import {
  RateLimitExceeded,
  makeRedisRateLimiter,
  type RateLimiter,
} from "./RateLimiter";
import { Effect, Exit, Context, Layer, Scope } from "effect";
import { RedisService, RedisClientLive, RedisError } from "./RedisClient";
import { Cause } from "effect";
import { type Server } from "bun"; // Import Server type

console.log("Starting Bun HTTP server (Effect idiomatic setup)...");

// --- Configuration for Different Roles ---
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const rateLimitConfigs: Record<string, RateLimitConfig> = {
  free: { windowMs: 5000, maxRequests: 5 }, // 5 requests per 5 seconds
  premium: { windowMs: 5000, maxRequests: 10 }, // 10 requests per 5 seconds
};

// --- Effect to Create Rate Limiters Declaratively ---
const createRateLimitersEffect: Effect.Effect<
  Readonly<Record<string, RateLimiter>>,
  never,
  RedisService
> = Effect.gen(function* () {
  yield* Effect.sync(() =>
    console.log("Describing creation of rate limiters...")
  );

  const limiterEffects = Object.entries(rateLimitConfigs).map(
    ([role, config]) => {
      if (!config) {
        // Should not happen based on current config, but handle defensively
        return Effect.succeed({ role, limiter: undefined });
      }
      // Use the makeRedisRateLimiter factory (returns Effect)
      return makeRedisRateLimiter(config).pipe(
        Effect.map((limiter) => ({
          role,
          limiter: limiter as RateLimiter | undefined,
        }))
      );
    }
  );

  // Run all creation effects (implicitly uses RedisService provided later)
  const results = yield* Effect.all(limiterEffects, {
    concurrency: "unbounded",
  });

  // Build the map from the results
  const limitersMap = results.reduce((acc, { role, limiter }) => {
    if (limiter) {
      acc[role] = limiter;
    }
    return acc;
  }, {} as Record<string, RateLimiter>);
  console.log(
    `Description complete. Rate limiters will be created for roles: ${Object.keys(
      limitersMap
    ).join(", ")}`
  );
  return limitersMap;
});

const getUserRole = (clientId: string): Effect.Effect<string> => {
  // Compute the role first
  const role = (() => {
    if (clientId.startsWith("premium-")) {
      return "premium";
    }
    if (clientId.startsWith("free-")) {
      return "free";
    }
    return "free";
  })();

  return Effect.succeed(role);
};

// Helper function to add CORS headers (Simplify back to sync function)
const addCorsHeaders = (response: Response, request?: Request): Response => {
  const origin = request?.headers.get("Origin");
  response.headers.set(
    "Access-Control-Allow-Origin",
    origin === "http://localhost:8080" ? origin : "*" // Allow localhost:8080 or fall back to *
  );
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization" // Headers allowed IN the request
  );
  // Add header to expose non-simple headers TO the response
  response.headers.set(
    "Access-Control-Expose-Headers",
    "Retry-After, X-Rate-Limit-Exceeded" // Expose Retry-After and our custom header
  );
  return response;
};

// --- Request Handling Logic (Refactored Effect function) ---
const handleRequest = (
  request: Request,
  // Receive the already created limiters map
  rateLimiters: Readonly<Record<string, RateLimiter>>
): Effect.Effect<Response, never> => // Always returns a Response Effect
  Effect.gen(function* () {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return addCorsHeaders(new Response(null, { status: 204 }), request);
    }
    console.log(`Handling request: ${request.method} ${request.url}`);

    // Auth & Client ID
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return addCorsHeaders(
        new Response("Unauthorized", { status: 401 }),
        request
      );
    }
    const clientId = authHeader.substring(7);
    yield* Effect.log(`Extracted Client ID: ${clientId}`);

    // Get Role (integrated into Effect chain)
    const userRole = yield* getUserRole(clientId);

    // Get Limiter (using the provided map)
    // Note: Using Record.get + Option helpers would be more robust than direct access
    const rateLimiter = rateLimiters[userRole] || rateLimiters["free"];
    if (!rateLimiter) {
      console.error(`No limiter for role: ${userRole}`);
      return addCorsHeaders(
        new Response("Internal Server Error - Limiter Config", { status: 500 }),
        request
      );
    }
    console.log(
      `Applying rate limit for role: ${userRole} (Client ID: ${clientId})`
    );

    // Check Rate Limit and map results/errors to Response using matchCause
    const checkEffect = rateLimiter.check(clientId);

    return yield* Effect.matchCause(checkEffect, {
      // Success case: check passed
      onSuccess: () => {
        console.log(`Rate limit check PASSED for Client ID: ${clientId}`);
        return addCorsHeaders(
          new Response(`Success (Role: ${userRole})`, {
            // Simplified success body
            headers: { "X-Rate-Limit-Remaining": "Available" }, // Example header
          }),
          request
        );
      },
      // Failure case: handle Fail, Die, Interrupt
      onFailure: (cause) => {
        let response: Response;
        // Check for specific Failure types first
        if (
          Cause.isFailType(cause) &&
          cause.error instanceof RateLimitExceeded
        ) {
          const error = cause.error; // Extract the error
          console.log(
            `Rate limit check FAILED (Exceeded) for Client ID: ${clientId}, Retry: ${
              error.retryAfter ?? "N/A"
            }`
          );
          const headers = new Headers({ "X-Rate-Limit-Exceeded": "true" });
          if (error.retryAfter) {
            headers.set("Retry-After", error.retryAfter.toString());
          }
          response = new Response("Too Many Requests", {
            status: 429,
            headers,
          });
        } else if (
          Cause.isFailType(cause) &&
          cause.error instanceof RedisError
        ) {
          console.log(
            `Rate limit check FAILED (Redis Error) for Client ID: ${clientId}`
          );
          console.error("Rate Limiter Redis Error Detail:", cause.error.cause);
          response = new Response(
            "Internal Server Error - Rate Limit Check Failed",
            { status: 500 }
          );
        } else {
          // Catch-all for other Failures, Defects (Die), Interruptions
          console.error(
            `Rate limit check FAILED (Unhandled Cause) for Client ID: ${clientId}`
          );
          console.error(
            "Unhandled Cause during rate limit check:",
            Cause.pretty(cause)
          ); // Log pretty cause
          response = new Response("Internal Server Error", { status: 500 });
        }
        return addCorsHeaders(response, request);
      },
    });
  }).pipe(
    // Catch any unexpected errors within the handleRequest generator itself
    Effect.catchAll((error) => {
      console.error("Unexpected error within handleRequest generator:", error);
      // Ensure CORS headers are added even to this generic error response
      return Effect.succeed(
        addCorsHeaders(new Response("Internal Server Error", { status: 500 }))
      );
    })
  );

// --- Define the Layer --- //
const AppLayer = RedisClientLive; // Provides RedisService

// --- Main Application Effect --- //
// This effect requires RedisService (via createRateLimitersEffect) and Scope (via acquireRelease)
const main = Effect.gen(function* () {
  // 1. Create the rate limiters first (requires RedisService)
  const rateLimiters = yield* createRateLimitersEffect;
  console.log("Rate limiters created successfully.");

  // 2. Define the server startup and shutdown within acquireRelease
  const server = yield* Effect.acquireRelease(
    // Acquire: Start the server
    Effect.sync(() => {
      console.log("Starting Bun server...");
      return serve({
        port: 3000,
        // websocket: undefined, // Add if needed
        fetch: (request, bunServer) => {
          // Run the request handling Effect for each request
          // Use runPromise as fetch needs a Promise<Response>
          return Effect.runPromise(handleRequest(request, rateLimiters));
        },
        error(error: Error) {
          console.error("Bun server error:", error);
          return new Response("Internal Server Error", { status: 500 });
        },
      });
    }),
    // Release: Stop the server
    (server: Server) =>
      Effect.sync(() => {
        console.log("Stopping Bun server...");
        server.stop(true); // Force close connections
        console.log("Bun server stopped.");
      })
  );

  console.log(`Effect server listening on http://localhost:${server.port}`);

  // 3. Suspend the main effect indefinitely to keep the server running
  yield* Effect.never;
});

// --- Remove Intermediate Runnable --- //
// const runnable: Effect.Effect<void, never, Scope> = Effect.provide(main, AppLayer);

// --- Run the Application within an explicit Scope, providing Layer inside --- //
Effect.runPromise(
  Effect.scoped(
    // Create a scope
    Effect.provide(
      // Provide the layer *within* this scope
      main, // Effect requiring RedisService & Scope
      AppLayer // Layer providing RedisService
    )
  )
)
  .then(() => console.log("Application finished gracefully."))
  .catch((err) => {
    console.error("Application failed:", err);
    process.exit(1);
  });

// --- Remove Layer.launch approach --- //
// Layer.launch(main).pipe(...) ...
