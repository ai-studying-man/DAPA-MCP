import { describe, expect, it } from "vitest"
import { stringifyBoundedToolResponse } from "../src/tools/law-api-tool-response.js"

describe("law API MCP response formatting", () => {
  it("keeps failures and a follow-up action outside a truncated preview", () => {
    // Given
    const response = {
      status: "PARTIAL_RESULT",
      errors: [{ code: "TIMEOUT", message: "upstream" }],
      data: "x".repeat(5000),
    }
    // When
    const parsed = JSON.parse(stringifyBoundedToolResponse(response, 1000))
    // Then
    expect(parsed).toMatchObject({ errors: [{ code: "TIMEOUT" }], nextAction: "narrow_or_page" })
  })
  it("returns valid bounded JSON when a response exceeds the MCP output limit", () => {
    // Given
    const response = {
      status: "OK",
      apiId: "law.detail",
      data: { 본문: "가".repeat(5_000) },
      errors: [],
    }

    // When
    const text = stringifyBoundedToolResponse(response, 1_000)
    const parsed = JSON.parse(text)

    // Then
    expect(text.length).toBeLessThanOrEqual(1_000)
    expect(parsed).toMatchObject({ status: "OK", truncated: true })
    expect(parsed.originalChars).toBeGreaterThan(1_000)
    expect(parsed.dataPreview).toContain("law.detail")
  })
})
