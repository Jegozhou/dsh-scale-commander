/**
 * The one error type the HTTP layer maps to a status and a stable code.
 *
 * Keeping it in its own module lets the router, the service, and the tools
 * share the type without importing each other.
 * @module host/api-error
 */

export class ApiError extends Error {
  /**
   * @param {number} status   HTTP status the browser should see.
   * @param {string} code     Stable machine-readable code.
   * @param {string} message  Human-readable message.
   * @param {unknown} [details] Structured context, e.g. validation problems.
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Turn any thrown value into the API envelope.
 * @param {unknown} error
 * @returns {{status: number, body: {error: {code: string, message: string, details?: unknown}}}}
 */
export function toApiFailure(error) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { error: { code: 'internal', message } } };
}
