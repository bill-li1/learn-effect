import { describe, expect, test, beforeAll, afterAll } from "bun:test";

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

  test("should use IP address for rate limiting when no Authorization header is provided", async () => {
    // Send multiple requests without Authorization header - should use IP
    // First few requests should succeed
    for (let i = 0; i < 5; i++) {
      const response = await fetch("http://localhost:3000");
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("Success (Role: free)");
    }

    // The 6th request should be rate limited because IP is used as identifier
    const rateLimitedResponse = await fetch("http://localhost:3000");
    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers.has("Retry-After")).toBe(true);
    expect(rateLimitedResponse.headers.get("X-Rate-Limit-Exceeded")).toBe("true");
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

  test(
    "IP-based rate limiting and client ID rate limiting should be separate",
    async () => {
      // Use up the rate limit for the IP
      for (let i = 0; i < 5; i++) {
        await fetch("http://localhost:3000");
      }
      
      // Verify IP is rate limited
      const ipLimitResponse = await fetch("http://localhost:3000");
      expect(ipLimitResponse.status).toBe(429);
      
      // But a request with client ID should still work
      const clientId = `separate-client-${Date.now()}`;
      const response = await fetch("http://localhost:3000", {
        headers: {
          Authorization: `Bearer ${clientId}`,
        },
      });
      
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("Success (Role: free)");
    }
  );

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
    "should allow IP-based requests again after the rate limit window expires",
    async () => {
      // Make 5 requests to hit the free tier limit (IP-based)
      for (let i = 0; i < 5; i++) {
        await fetch("http://localhost:3000");
      }
      
      // Verify IP is rate limited
      const rateLimitedResponse = await fetch("http://localhost:3000");
      expect(rateLimitedResponse.status).toBe(429);

      // Wait for the rate limit window to expire (5 seconds + buffer)
      await new Promise((resolve) => setTimeout(resolve, 5100));

      // Should be allowed to make requests again
      const response = await fetch("http://localhost:3000");
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

  // Admin override feature tests
  test("should bypass rate limit when admin override is set", async () => {
    const clientId = `rate-limited-client-${Date.now()}`;

    // Make successful requests up to the free tier limit (5 requests)
    for (let i = 0; i < 5; i++) {
      await fetch("http://localhost:3000", {
        headers: {
          Authorization: `Bearer ${clientId}`,
        },
      });
    }

    // Verify this client is now rate limited
    const rateLimitedResponse = await fetch("http://localhost:3000", {
      headers: {
        Authorization: `Bearer ${clientId}`,
      },
    });
    expect(rateLimitedResponse.status).toBe(429);

    // Setup admin override for this client
    const adminResponse = await fetch(
      "http://localhost:3000/admin/override-rate-limit",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId: clientId,
          override: true,
        }),
      }
    );

    expect(adminResponse.status).toBe(200);
    const adminBody = (await adminResponse.json()) as { message: string };
    expect(adminBody.message).toContain(`Override for ${clientId} set to true`);

    // Client should now bypass rate limiting
    const bypassResponse = await fetch("http://localhost:3000", {
      headers: {
        Authorization: `Bearer ${clientId}`,
      },
    });

    expect(bypassResponse.status).toBe(200);
    const bypassText = await bypassResponse.text();
    expect(bypassText).toContain("Success (Override Active)");
    expect(bypassResponse.headers.get("X-Rate-Limit-Remaining")).toBe(
      "Overridden"
    );
  });

  test("should re-enable rate limiting when admin override is turned off", async () => {
    const clientId = `toggle-client-${Date.now()}`;

    // Set up the override first
    await fetch("http://localhost:3000/admin/override-rate-limit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: clientId,
        override: true,
      }),
    });

    // Make lots of requests (more than the limit)
    for (let i = 0; i < 10; i++) {
      const response = await fetch("http://localhost:3000", {
        headers: {
          Authorization: `Bearer ${clientId}`,
        },
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("Success (Override Active)");
    }

    // Turn off the override
    await fetch("http://localhost:3000/admin/override-rate-limit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: clientId,
        override: false,
      }),
    });

    // Make 5 requests (free tier limit)
    for (let i = 0; i < 5; i++) {
      const response = await fetch("http://localhost:3000", {
        headers: {
          Authorization: `Bearer ${clientId}`,
        },
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain("Override Active");
    }

    // The 6th request should now be rate limited
    const rateLimitedResponse = await fetch("http://localhost:3000", {
      headers: {
        Authorization: `Bearer ${clientId}`,
      },
    });
    expect(rateLimitedResponse.status).toBe(429);
  });
  
  test("admin override should not work for IP-based rate limiting", async () => {
    // First get the IP address used for testing
    let ipAddress = "";
    
    // Make a request to determine the IP used by the server
    const initialResponse = await fetch("http://localhost:3000");
    if (initialResponse.status === 200) {
      const text = await initialResponse.text();
      // The IP is in the response (simplified assumption for test purposes)
      // In a real test, we'd need to get this information another way
      ipAddress = "127.0.0.1"; // Assuming localhost IP for test
    }
    
    // Use up the rate limit for IP
    for (let i = 0; i < 5; i++) {
      await fetch("http://localhost:3000");
    }
    
    // Try to set an override for the IP
    await fetch("http://localhost:3000/admin/override-rate-limit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: ipAddress,
        override: true,
      }),
    });
    
    // IP-based request should still be rate-limited 
    // (overrides only work with Authorization header)
    const rateLimitedResponse = await fetch("http://localhost:3000");
    expect(rateLimitedResponse.status).toBe(429);
  });
});
