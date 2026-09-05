import { stringifyBoundedToolResponse } from "./law-api-tool-response.js"

const DEFAULT_MAX_TOOL_RESPONSE_CHARS = 250_000

export function textResult(
  value: object,
  isError = false,
): {
  content: [{ type: "text"; text: string }]
  isError: boolean
} {
  return {
    content: [
      {
        type: "text",
        text: stringifyBoundedToolResponse(value, DEFAULT_MAX_TOOL_RESPONSE_CHARS),
      },
    ],
    isError,
  }
}

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const
