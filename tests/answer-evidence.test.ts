import { describe, expect, it } from "vitest"
import { answerEvidence } from "../src/providers/law/answer-evidence.js"
import type { LegalContentHit } from "../src/providers/law/content-search.js"

function hit(text: string, match: LegalContentHit["match"]): LegalContentHit {
  return {
    document: {
      id: "1",
      documentId: "1",
      source: "official",
      sourceType: "law",
      title: "방위사업법",
      status: "current",
      verified: true,
      retrievedAt: "2026-10-27",
    },
    status: "OK",
    match,
    excerpts: [text],
    errors: [],
  }
}

describe("answer evidence gate", () => {
  it("rejects a constitutional case with freedom language but no requested procurement issue", () => {
    const unrelated = hit("직업의 자유와 퇴직급여의 평등권", "content")
    const result = answerEvidence("입찰참가자격 제한이 직업의 자유를 침해하나요?", [
      {
        ...unrelated,
        document: { ...unrelated.document, sourceType: "constitutional_case" },
      },
    ])
    expect(result.decision).toBe("partial")
    expect(result.missingTerms).toContain("입찰참가자격 제한")
  })

  it("abstains when only search metadata is available", () => {
    // Given / When
    const result = answerEvidence("군수품이란?", [hit("군수품 정의", "metadata")])
    // Then
    expect(result.decision).toBe("abstain")
  })

  it("marks a comparison partial when one concept is missing", () => {
    // Given / When
    const result = answerEvidence("선행연구와 사업타당성조사는 어떻게 다른가요?", [
      hit("선행연구 정의", "content"),
    ])
    // Then
    expect(result.decision).toBe("partial")
    expect(result.missingTerms).toContain("사업타당성조사")
  })

  it("identifies evidence without pretending to verify the legal conclusion", () => {
    // Given / When
    const result = answerEvidence("선행연구와 사업타당성조사는 어떻게 다른가요?", [
      hit("선행연구 정의", "content"),
      hit("사업타당성조사 절차", "content"),
    ])
    // Then
    expect(result.decision).toBe("grounded")
    expect(result.claimVerification).toBe("not_performed")
  })
})
