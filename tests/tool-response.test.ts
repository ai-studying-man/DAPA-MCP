import { describe, expect, it } from "vitest"
import { textResult } from "../src/tools/tool-response.js"

describe("textResult", () => {
  it("bounds large tool responses before returning them to the MCP client", () => {
    // Given
    const payload = { status: "OK", content: "가".repeat(300_000) }

    // When
    const result = textResult(payload)

    // Then
    expect(result.content[0].text.length).toBeLessThanOrEqual(250_000)
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      status: "OK",
      truncated: true,
      originalChars: expect.any(Number),
    })
  })
})
