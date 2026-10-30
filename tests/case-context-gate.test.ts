import { describe, expect, it } from "vitest"
import { answerEvidence } from "../src/providers/law/answer-evidence.js"
import type { LegalContentHit } from "../src/providers/law/content-search.js"

describe("case context evidence", () => {
  it("does not treat a quoted defense delay clause as a delay holding", () => {
    const hit: LegalContentHit = {
      document: {
        id: "incidental",
        documentId: "incidental",
        source: "official",
        sourceType: "precedent",
        title: "정산금청구",
        status: "unknown",
        verified: true,
        retrievedAt: "2026-10-30",
      },
      status: "OK",
      match: "content",
      excerpts: ["방위사업청 협약 제15조 지체상금. 이 사건 판단은 환율 정산 및 관할이다."],
      errors: [],
    }
    const result = answerEvidence("방산물자 계약 지체상금 판례를 알려줘", [hit])
    expect(result.decision).toBe("partial")
    expect(result.missingTerms).toContain("지체상금 판단과 방위사업 사실관계의 직접 연관성")
  })
})
