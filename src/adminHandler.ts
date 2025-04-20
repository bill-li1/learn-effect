import { Effect, Data, Cause, Either } from "effect";
import { type Server } from "bun"; // Assuming Response type is globally available or imported elsewhere

// --- Custom Admin Errors ---
export class InvalidContentTypeError extends Data.TaggedError(
  "InvalidContentTypeError"
)<{
  readonly providedType?: string;
}> {}
export class JsonParseError extends Data.TaggedError("JsonParseError")<{
  readonly error: unknown;
}> {}
export class InvalidRequestBodyError extends Data.TaggedError(
  "InvalidRequestBodyError"
)<{
  readonly body: unknown;
}> {}

// --- Body Interface ---
export interface AdminOverrideBody {
  clientId: string;
  override: boolean;
}

// --- Helper Effects ---

/**
 * Checks if the request's Content-Type header includes "application/json".
 * Fails with InvalidContentTypeError if not. Succeeds with void otherwise.
 */
export const checkContentType = (
  request: Request
): Effect.Effect<void, InvalidContentTypeError> => {
  const contentType = request.headers.get("content-type") ?? "";
  const failure = Effect.fail(
    new InvalidContentTypeError({ providedType: contentType })
  );
  return Effect.when(
    failure,
    () => !contentType.includes("application/json")
  ).pipe(Effect.asVoid);
};

/**
 * Parses the request body as JSON.
 * Succeeds with the unknown parsed body, fails on parsing error.
 */
export const parseJsonBody = (
  request: Request
): Effect.Effect<unknown, JsonParseError> =>
  Effect.tryPromise({
    try: () => request.json() as Promise<unknown>,
    catch: (error) => new JsonParseError({ error }),
  });

/**
 * Validates the raw body using a type predicate.
 * Succeeds with the typed AdminOverrideBody, fails with InvalidRequestBodyError.
 * Simplified approach using direct check and Effect.fail.
 */
export const validateAdminBodyManual = (
  rawBody: unknown
): Effect.Effect<AdminOverrideBody, InvalidRequestBodyError> => {
  const isValidBody = (b: unknown): b is AdminOverrideBody =>
    typeof b === "object" &&
    b !== null &&
    "clientId" in b &&
    typeof b.clientId === "string" &&
    "override" in b &&
    typeof b.override === "boolean";

  if (isValidBody(rawBody)) {
    // If valid, succeed with the narrowed type
    return Effect.succeed(rawBody);
  } else {
    // If invalid, log and then fail
    return Effect.logWarning(
      "Invalid admin request body received (Manual)"
    ).pipe(
      Effect.annotateLogs({ body: JSON.stringify(rawBody) }),
      // Use flatMap to return the failure Effect after logging
      Effect.flatMap(() =>
        Effect.fail(new InvalidRequestBodyError({ body: rawBody }))
      )
    );
  }
};

/**
 * Updates the overrides map (synchronous side effect).
 */
export const updateOverrides = (
  body: AdminOverrideBody,
  overrides: Map<string, boolean>
): Effect.Effect<void> => // No failure expected here
  Effect.sync(() => {
    // Log before the update for clarity
    Effect.log(
      `Admin: Setting override for ${body.clientId} to ${body.override}`
    );
    overrides.set(body.clientId, body.override);
  });

/**
 * Creates the successful JSON response object (without CORS headers yet).
 */
export const createSuccessResponse = (
  body: AdminOverrideBody
): Effect.Effect<Response> => // No failure expected here
  Effect.succeed(
    new Response(
      JSON.stringify({
        message: `Override for ${body.clientId} set to ${body.override}.`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )
  );

// --- Main Handler (using Manual validation helper) ---
export const handleAdminOverrideRequest = (
  request: Request,
  overrides: Map<string, boolean>
): Effect.Effect<
  Response, // Success type is Response (before CORS)
  InvalidContentTypeError | JsonParseError | InvalidRequestBodyError
> =>
  Effect.gen(function* () {
    yield* Effect.log("Handling admin override request (composed)...", {
      service: "AdminService",
      operation: "handleOverride",
    });

    // Execute helpers sequentially
    yield* checkContentType(request);
    const rawBody = yield* parseJsonBody(request);
    const validatedBody = yield* validateAdminBodyManual(rawBody);
    yield* updateOverrides(validatedBody, overrides);
    const response = yield* createSuccessResponse(validatedBody);

    // Return the raw response; CORS headers will be added by the caller in server.ts
    return response;
  }); // Removed annotateLogs pipe, integrated into initial log
