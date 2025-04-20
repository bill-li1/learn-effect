import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import Redis from "ioredis-mock";
import { RedisService } from "../src/RedisClient";

// Server under test
let serverProcess: { kill: () => void };

// Set a longer timeout for tests that need it (default is 5s)
const LONG_TEST_TIMEOUT = 15000;

describe("HTTP Server with Rate Limiter", () => {
  // Start server before tests
  beforeAll(async () => {
    // Start the server in a child process
    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      stdout: "pipe", // Prevent console noise during tests
    });

    // Give the server a moment to start
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  // Stop server after tests
  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  test("should respond with 401 when no Authorization header is provided", async () => {
    const response = await fetch("http://localhost:3000");
    expect(response.status).toBe(401);
  });

  test("should respond with a success message when valid Authorization header is provided", async () => {
    const response = await fetch("http://localhost:3000", {
      headers: {
        Authorization: "Bearer test-client",
      },
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Success (Role: free)");
    expect(response.headers.get("X-Rate-Limit-Remaining")).toBe("Available");
  });

  test("should enforce free tier rate limits for unrecognized client pattern", async () => {
    const clientId = `test-client-${Date.now()}`; // Unique client ID defaulting to free tier

    // Make successful requests up to the free tier limit (5 requests)
    for (let i = 0; i < 5; i++) {
      const response = await fetch("http://localhost:3000", {
        headers: {
          Authorization: `Bearer ${clientId}`,
        },
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(`Success (Role: free)`);
    }

    // The 6th request should be rate limited
    const rateLimitedResponse = await fetch("http://localhost:3000", {
      headers: {
        Authorization: `Bearer ${clientId}`,
      },
    });

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers.has("Retry-After")).toBe(true);
    expect(rateLimitedResponse.headers.get("X-Rate-Limit-Exceeded")).toBe(
      "true"
    );
  });

  test("should enforce free tier rate limits", async () => {
    const clientId = `free-client-${Date.now()}`; // Free tier client ID

    // Make successful requests up to the free tier limit (5 requests)
    for (let i = 0; i < 5; i++) {
      const response = await fetch("http://localhost:3000", {
        headers: {
          Authorization: `Bearer ${clientId}`,
        },
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(`Success (Role: free)`);
    }

    // The 6th request should be rate limited
    const rateLimitedResponse = await fetch("http://localhost:3000", {
      headers: {
        Authorization: `Bearer ${clientId}`,
      },
    });

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers.has("Retry-After")).toBe(true);
    expect(rateLimitedResponse.headers.get("X-Rate-Limit-Exceeded")).toBe(
      "true"
    );
  });

  test("should enforce premium tier rate limits", async () => {
    const clientId = `premium-client-${Date.now()}`; // Premium tier client ID

    // Make successful requests up to the premium tier limit (10 requests)
    for (let i = 0; i < 10; i++) {
      const response = await fetch("http://localhost:3000", {
        headers: {
          Authorization: `Bearer ${clientId}`,
        },
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(`Success (Role: premium)`);
    }

    // The 11th request should be rate limited
    const rateLimitedResponse = await fetch("http://localhost:3000", {
      headers: {
        Authorization: `Bearer ${clientId}`,
      },
    });

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers.has("Retry-After")).toBe(true);
    expect(rateLimitedResponse.headers.get("X-Rate-Limit-Exceeded")).toBe(
      "true"
    );
  });

  test(
    "should allow requests again after the rate limit window expires for free tier",
    async () => {
      const clientId = `free-expiry-${Date.now()}`;

      // Make 5 requests to hit the free tier limit
      for (let i = 0; i < 5; i++) {
        await fetch("http://localhost:3000", {
          headers: {
            Authorization: `Bearer ${clientId}`,
          },
        });
      }

      // Wait for the rate limit window to expire (5 seconds + buffer)
      await new Promise((resolve) => setTimeout(resolve, 5100));

      // Should be allowed to make requests again
      const response = await fetch("http://localhost:3000", {
        headers: {
          Authorization: `Bearer ${clientId}`,
        },
      });

      expect(response.status).toBe(200);
    },
    LONG_TEST_TIMEOUT
  );

  test(
    "should allow requests again after the rate limit window expires for premium tier",
    async () => {
      const clientId = `premium-expiry-${Date.now()}`;

      // Make 10 requests to hit the premium tier limit
      for (let i = 0; i < 10; i++) {
        await fetch("http://localhost:3000", {
          headers: {
            Authorization: `Bearer ${clientId}`,
          },
        });
      }

      // Wait for the rate limit window to expire (5 seconds + buffer)
      await new Promise((resolve) => setTimeout(resolve, 5100));

      // Should be allowed to make requests again
      const response = await fetch("http://localhost:3000", {
        headers: {
          Authorization: `Bearer ${clientId}`,
        },
      });

      expect(response.status).toBe(200);
    },
    LONG_TEST_TIMEOUT
  );

  test("should handle CORS preflight requests", async () => {
    const response = await fetch("http://localhost:3000", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:8080",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:8080"
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "Authorization"
    );
  });
});