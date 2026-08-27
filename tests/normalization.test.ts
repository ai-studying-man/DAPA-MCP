import { describe, expect, it } from "vitest"
import { normalizeSearchText, similarityScore } from "../src/lib/normalization/text.js"

describe("normalizeSearchText", () => {
  it("normalizes Korean spacing and Latin case", () => {
    // Given
    const query = "  IＰＴ (통합 사업 관리 팀)  "

    // When
    const normalized = normalizeSearchText(query)

    // Then
    expect(normalized).toBe("ipt통합사업관리팀")
  })
})

describe("similarityScore", () => {
  it("scores a one-character typo higher than an unrelated term", () => {
    // Given
    const query = "통합사업관리팀"

    // When
    const near = similarityScore(query, "통합사업관리팁")
    const far = similarityScore(query, "방위사업청")

    // Then
    expect(near).toBeGreaterThan(far)
  })
})
