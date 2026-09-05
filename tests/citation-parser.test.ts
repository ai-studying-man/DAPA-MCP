import { describe, expect, it } from "vitest"
import { parseCitation } from "../src/lib/citation/parser.js"

describe("parseCitation", () => {
  it("parses a Korean law article citation", () => {
    // Given
    const citation = "방위사업법 제3조제1항"

    // When
    const parsed = parseCitation(citation)

    // Then
    expect(parsed).toEqual({
      raw: citation,
      kind: "law",
      documentName: "방위사업법",
      article: "제3조제1항",
    })
  })

  it("parses a Supreme Court case number", () => {
    // Given
    const citation = "대법원 2020두12345"

    // When
    const parsed = parseCitation(citation)

    // Then
    expect(parsed).toEqual({
      raw: citation,
      kind: "case",
      documentName: "대법원",
      caseNumber: "2020두12345",
    })
  })

  it("parses a claimed article title for content verification", () => {
    // Given
    const citation = "방위사업법 제3조(계약해제)"

    // When
    const parsed = parseCitation(citation)

    // Then
    expect(parsed).toEqual({
      raw: citation,
      kind: "law",
      documentName: "방위사업법",
      article: "제3조",
      claimedArticleTitle: "계약해제",
    })
  })

  it("marks unsupported prose as unknown", () => {
    // Given
    const citation = "근거가 있을 것 같습니다"

    // When
    const parsed = parseCitation(citation)

    // Then
    expect(parsed.kind).toBe("unknown")
  })
})
