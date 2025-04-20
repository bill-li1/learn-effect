import { serve } from "bun";
import { makeInMemoryRateLimiter, RateLimitExceeded } from "./RateLimiter"; // Import the factory and error
import { Effect, Exit } from "effect";

console.log("Starting Bun HTTP server...");

// Create a rate limiter instance: 5 requests per 10 seconds
const rateLimiter = makeInMemoryRateLimiter({
  windowMs: 10000, // 10 seconds
  maxRequests: 5,
});

serve({
  port: 3000,
  fetch(request) {
    console.log(`Received request for: ${request.url}`);

    // 1. Extract Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response("Unauthorized: Missing or invalid Bearer token", {
        status: 401,
      });
    }

    const clientId = authHeader.substring(7); // Extract token as clientId

    // 2. Check rate limit using the created instance
    const result = Effect.runSyncExit(rateLimiter.check(clientId));

    // 3. Handle result
    if (Exit.isSuccess(result)) {
      // Rate limit check passed, proceed with the request
      return new Response(`Hello ${clientId}!`); // Respond with hello to the client
    } else {
      // Rate limit check failed or other error occurred
      const cause = result.cause;
      // Handle RateLimitExceeded error
      if (cause._tag === "Die" && cause.defect?._tag === "RateLimitExceeded") {
        const error = cause.defect;
        const headers = new Headers();
        if (error.retryAfter) {
          headers.set("Retry-After", error.retryAfter.toString());
        }
        return new Response("Too Many Requests", {
          status: 429,
          headers: headers,
        });
      } else {
        // Handle unexpected errors
        console.error("Unexpected error during rate limit check:", cause);
        return new Response("Internal Server Error", { status: 500 });
      }
    }
  },
});

console.log("Bun server listening on http://localhost:3000");
