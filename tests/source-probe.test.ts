import { describe, expect, it } from "vitest"
import { articleIdentity, citationLocationExists } from "../src/providers/law/citation-location.js"
import { catalogFreshness, probeLawSource } from "../src/providers/law/source-probe.js"
import type { SearchResponse } from "../src/types/results.js"

describe("operational evidence checks", () => {
  it("reports unavailable when configured credentials cannot reach the source", async () => {
    // Given
    const failed: SearchResponse = {
      status: "SOURCE_UNAVAILABLE",
      results: [],
      errors: [{ code: "TIMEOUT", message: "timeout" }],
    }
    // When
    const result = await probeLawSource({
      health: () => "healthy",
      search: async () => failed,
      getDetail: async () => failed,
    })
    // Then
    expect(result.state).toBe("unavailable")
  })

  it("flags a loaded but outdated catalog as stale", () => {
    // Given / When
    const result = catalogFreshness("2026-08-27T00:00:00Z", Date.parse("2026-10-27T00:00:00Z"))
    // Then
    expect(result.state).toBe("stale")
  })

  it("rejects a missing item even when the article exists", () => {
    // Given
    const article = { articleNumber: "3", text: "제3조(정의)\n1. 군수품\n2. 획득" }
    // When / Then
    expect(citationLocationExists(article, "제3조제999호")).toBe(false)
    expect(citationLocationExists(article, "제3조제2호")).toBe(true)
  })

  it("matches branch numbers encoded separately by the official API", () => {
    // Given / When
    const identity = articleIdentity({ articleNumber: "22", branch: "2", text: "제22조의2" })
    // Then
    expect(identity).toBe("22의2")
  })

  it("does not verify an item from a different paragraph", () => {
    // Given
    const article = { articleNumber: "3", text: "제3조\n① 내용\n1. 첫 항\n② 내용\n2. 둘째 항" }
    // When / Then
    expect(citationLocationExists(article, "제3조제1항제2호")).toBe(false)
    expect(citationLocationExists(article, "제3조제2항제2호")).toBe(true)
  })
})
