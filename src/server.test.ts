import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { serve } from "bun";
import { Effect } from "effect";

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
    await new Promise(resolve => setTimeout(resolve, 1000));
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
  
  test("should respond with a greeting when valid Authorization header is provided", async () => {
    const response = await fetch("http://localhost:3000", {
      headers: {
        "Authorization": "Bearer test-client"
      }
    });
    
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello test-client!");
  });
  
  test("should enforce rate limits after exceeding maximum requests", async () => {
    const clientId = `test-client-${Date.now()}`; // Unique client ID
    
    // Make successful requests up to the limit (5 requests)
    for (let i = 0; i < 5; i++) {
      const response = await fetch("http://localhost:3000", {
        headers: {
          "Authorization": `Bearer ${clientId}`
        }
      });
      expect(response.status).toBe(200);
    }
    
    // The 6th request should be rate limited
    const rateLimitedResponse = await fetch("http://localhost:3000", {
      headers: {
        "Authorization": `Bearer ${clientId}`
      }
    });
    
    // Now that we've fixed the server, we should expect a 429 status
    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers.has("Retry-After")).toBe(true);
  });
  
  test("should allow requests again after the rate limit window expires", async () => {
    const clientId = `test-client-expiry-${Date.now()}`;
    
    // Make 5 requests to hit the limit
    for (let i = 0; i < 5; i++) {
      await fetch("http://localhost:3000", {
        headers: {
          "Authorization": `Bearer ${clientId}`
        }
      });
    }
    
    // Wait for the rate limit window to expire (10 seconds + buffer)
    await new Promise(resolve => setTimeout(resolve, 11000));
    
    // Should be allowed to make requests again
    const response = await fetch("http://localhost:3000", {
      headers: {
        "Authorization": `Bearer ${clientId}`
      }
    });
    
    expect(response.status).toBe(200);
  }, LONG_TEST_TIMEOUT); // Extend timeout for this specific test
});