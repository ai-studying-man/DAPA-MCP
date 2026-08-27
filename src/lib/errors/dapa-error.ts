export const ERROR_CODES = [
  "NOT_FOUND",
  "SOURCE_UNAVAILABLE",
  "TIMEOUT",
  "RATE_LIMITED",
  "AUTH_REQUIRED",
  "PROVIDER_NOT_CONFIGURED",
  "INVALID_ARGUMENT",
  "AMBIGUOUS",
  "PARTIAL_RESULT",
  "INTERNAL_ERROR",
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export class DapaError extends Error {
  readonly name = "DapaError"

  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
