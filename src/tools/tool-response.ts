export function textResult(
  value: object,
  isError = false,
): {
  content: [{ type: "text"; text: string }]
  isError: boolean
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError,
  }
}

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const
