import { describe, test, expect } from "bun:test";
import { Effect, Exit } from "effect";
import {
  checkContentType,
  parseJsonBody,
  validateAdminBodyManual,
  updateOverrides,
  createSuccessResponse,
  handleAdminOverrideRequest,
  InvalidContentTypeError,
  JsonParseError,
  InvalidRequestBodyError,
  type AdminOverrideBody,
} from "../src/adminHandler";

describe("Admin Handler Component Tests", () => {
  describe("checkContentType", () => {
    test("succeeds with correct content type", async () => {
      const request = new Request("https://example.com", {
        headers: { "Content-Type": "application/json" },
      });

      const result = await Effect.runPromiseExit(checkContentType(request));
      expect(Exit.isSuccess(result)).toBe(true);
    });

    test("succeeds with content type that includes application/json", async () => {
      const request = new Request("https://example.com", {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });

      const result = await Effect.runPromiseExit(checkContentType(request));
      expect(Exit.isSuccess(result)).toBe(true);
    });

    test("fails with incorrect content type", async () => {
      const request = new Request("https://example.com", {
        headers: { "Content-Type": "text/plain" },
      });

      const result = await Effect.runPromiseExit(checkContentType(request));
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(InvalidContentTypeError);
        expect(result.cause.error.providedType).toBe("text/plain");
      }
    });

    test("fails with missing content type", async () => {
      const request = new Request("https://example.com");

      const result = await Effect.runPromiseExit(checkContentType(request));
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(InvalidContentTypeError);
        expect(result.cause.error.providedType).toBe("");
      }
    });
  });

  describe("parseJsonBody", () => {
    test("successfully parses valid JSON body", async () => {
      const body = { clientId: "test-client", override: true };
      const request = new Request("https://example.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await Effect.runPromiseExit(parseJsonBody(request));
      expect(Exit.isSuccess(result)).toBe(true);

      if (Exit.isSuccess(result)) {
        expect(result.value).toEqual(body);
      }
    });

    test("fails with invalid JSON body", async () => {
      const request = new Request("https://example.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid-json}",
      });

      const result = await Effect.runPromiseExit(parseJsonBody(request));
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(JsonParseError);
      }
    });
  });

  describe("validateAdminBodyManual", () => {
    test("validates correct admin body", async () => {
      const validBody = { clientId: "test-client", override: true };

      const result = await Effect.runPromiseExit(
        validateAdminBodyManual(validBody)
      );
      expect(Exit.isSuccess(result)).toBe(true);

      if (Exit.isSuccess(result)) {
        expect(result.value).toEqual(validBody);
      }
    });

    test("rejects body with missing clientId", async () => {
      const invalidBody = { override: true };

      const result = await Effect.runPromiseExit(
        validateAdminBodyManual(invalidBody)
      );
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(InvalidRequestBodyError);
        expect(result.cause.error.body).toEqual(invalidBody);
      }
    });

    test("rejects body with missing override", async () => {
      const invalidBody = { clientId: "test-client" };

      const result = await Effect.runPromiseExit(
        validateAdminBodyManual(invalidBody)
      );
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(InvalidRequestBodyError);
        expect(result.cause.error.body).toEqual(invalidBody);
      }
    });

    test("rejects body with invalid types", async () => {
      const invalidBody = { clientId: 123, override: "yes" };

      const result = await Effect.runPromiseExit(
        validateAdminBodyManual(invalidBody)
      );
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(InvalidRequestBodyError);
        expect(result.cause.error.body).toEqual(invalidBody);
      }
    });

    test("rejects non-object body", async () => {
      const invalidBody = "not an object";

      const result = await Effect.runPromiseExit(
        validateAdminBodyManual(invalidBody)
      );
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(InvalidRequestBodyError);
        expect(result.cause.error.body).toEqual(invalidBody);
      }
    });
  });

  describe("updateOverrides", () => {
    test("adds a new override", async () => {
      const overridesMap = new Map<string, boolean>();
      const body: AdminOverrideBody = {
        clientId: "test-client",
        override: true,
      };

      await Effect.runPromise(updateOverrides(body, overridesMap));

      expect(overridesMap.has("test-client")).toBe(true);
      expect(overridesMap.get("test-client")).toBe(true);
    });

    test("updates an existing override", async () => {
      const overridesMap = new Map<string, boolean>();
      overridesMap.set("test-client", true);
      const body: AdminOverrideBody = {
        clientId: "test-client",
        override: false,
      };

      await Effect.runPromise(updateOverrides(body, overridesMap));

      expect(overridesMap.has("test-client")).toBe(true);
      expect(overridesMap.get("test-client")).toBe(false);
    });
  });

  describe("createSuccessResponse", () => {
    test("creates a response with the correct message", async () => {
      const body: AdminOverrideBody = {
        clientId: "test-client",
        override: true,
      };

      const responseEffect = createSuccessResponse(body);
      const response = await Effect.runPromise(responseEffect);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const responseBody = (await response.json()) as { message: string };
      expect(responseBody.message).toContain("test-client");
      expect(responseBody.message).toContain("true");
    });
  });

  describe("handleAdminOverrideRequest", () => {
    test("successfully processes a valid admin request", async () => {
      const overridesMap = new Map<string, boolean>();
      const body = { clientId: "test-client", override: true };
      const request = new Request(
        "https://example.com/admin/override-rate-limit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      const result = await Effect.runPromiseExit(
        handleAdminOverrideRequest(request, overridesMap)
      );
      expect(Exit.isSuccess(result)).toBe(true);

      if (Exit.isSuccess(result)) {
        expect(result.value.status).toBe(200);
        const responseBody = (await result.value.json()) as { message: string };
        expect(responseBody.message).toContain("test-client");
        expect(responseBody.message).toContain("true");
      }

      // Check that the override was actually set
      expect(overridesMap.has("test-client")).toBe(true);
      expect(overridesMap.get("test-client")).toBe(true);
    });

    test("handles invalid content type", async () => {
      const overridesMap = new Map<string, boolean>();
      const body = { clientId: "test-client", override: true };
      const request = new Request(
        "https://example.com/admin/override-rate-limit",
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify(body),
        }
      );

      const result = await Effect.runPromiseExit(
        handleAdminOverrideRequest(request, overridesMap)
      );
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(InvalidContentTypeError);
      }

      // Check that no override was set
      expect(overridesMap.has("test-client")).toBe(false);
    });

    test("handles invalid JSON", async () => {
      const overridesMap = new Map<string, boolean>();
      const request = new Request(
        "https://example.com/admin/override-rate-limit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{invalid-json}",
        }
      );

      const result = await Effect.runPromiseExit(
        handleAdminOverrideRequest(request, overridesMap)
      );
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(JsonParseError);
      }

      // Check that no override was set
      expect(overridesMap.size).toBe(0);
    });

    test("handles invalid request body", async () => {
      const overridesMap = new Map<string, boolean>();
      const invalidBody = { clientId: "test-client" }; // Missing override field
      const request = new Request(
        "https://example.com/admin/override-rate-limit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(invalidBody),
        }
      );

      const result = await Effect.runPromiseExit(
        handleAdminOverrideRequest(request, overridesMap)
      );
      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result) && result.cause._tag === "Fail") {
        expect(result.cause.error).toBeInstanceOf(InvalidRequestBodyError);
      }

      // Check that no override was set
      expect(overridesMap.size).toBe(0);
    });
  });
});
