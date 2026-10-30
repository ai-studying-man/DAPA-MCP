import { describe, expect, it } from "vitest"
import { answerEvidence } from "../src/providers/law/answer-evidence.js"
import type { LegalContentHit } from "../src/providers/law/content-search.js"
import { selectMatchingDetail } from "../src/providers/law/content-search-evidence.js"

const document = {
  id: "current",
  documentId: "current",
  source: "official",
  sourceType: "law",
  title: "방위사업법",
  status: "current",
  verified: true,
  retrievedAt: "2026-10-30",
  sourceUrl: "https://www.law.go.kr/DRF/lawService.do?target=law&MST=current",
} as const

describe("substantive comparison evidence", () => {
  it.each([false, true])(
    "keeps forwarding-only articles partial with modal language=%s",
    (modal) => {
      // Given
      const hits: LegalContentHit[] = [
        {
          document,
          status: "OK",
          match: "content",
          errors: [],
          detail: {
            basicInfo: { title: "방위사업법" },
            supplementaryProvisions: [],
            annexes: [],
            forms: [],
            articles: [
              {
                articleNumber: "1",
                title: "선행연구 수행",
                text: modal
                  ? "선행연구는 별도 지침에 따라 수행하여야 한다."
                  : "선행연구 수행은 별도 지침을 따른다",
              },
              {
                articleNumber: "2",
                title: "사업타당성조사 실시",
                text: modal
                  ? "사업타당성조사는 다른 규정에 따라 실시하여야 한다."
                  : "사업타당성조사 실시는 다른 규정에 따른다",
              },
            ],
          },
        },
      ]
      // When
      const result = answerEvidence("선행연구와 사업타당성조사는 어떻게 다른가요?", hits)
      // Then
      expect(result.decision).toBe("partial")
    },
  )
  it("does not treat a joint incidental mention as comparison coverage", () => {
    // Given
    const hits: LegalContentHit[] = [
      {
        document,
        status: "OK",
        match: "content",
        errors: [],
        excerpts: ["선행연구 및 사업타당성조사 결과를 반영한다."],
      },
    ]
    // When
    const result = answerEvidence("선행연구와 사업타당성조사는 어떻게 다른가요?", hits)
    // Then
    expect(result.decision).toBe("partial")
  })

  it("prioritizes actual definitions over incidental titled articles", () => {
    // Given
    const detail = {
      basicInfo: { title: "방위사업법" },
      articles: [
        {
          articleNumber: "11",
          title: "방위력개선사업 수행의 기본원칙",
          text: "방위력개선사업의 원칙",
        },
        { articleNumber: "27", title: "군수품목록정보", text: "군수품의 목록정보" },
        {
          articleNumber: "3",
          title: "정의",
          text: '1. "방위력개선사업"이라 함은 무기체계의 구매와 연구개발을 말한다.\n2. "군수품"이라 함은 군에서 쓰는 물품을 말한다.',
        },
      ],
      supplementaryProvisions: [],
      annexes: [],
      forms: [],
    }
    // When
    const selected = selectMatchingDetail(detail, ["방위력개선사업", "군수품"])
    // Then
    expect(selected?.articles[0]?.articleNumber).toBe("3")
  })
})
