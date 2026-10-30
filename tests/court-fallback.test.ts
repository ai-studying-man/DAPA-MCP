import { describe, expect, it } from "vitest"
import { searchWithCourtFallback } from "../src/providers/law/court-fallback.js"
import type { LegalSearchInput } from "../src/providers/law/law-provider.js"
import type { SearchResponse } from "../src/types/results.js"

const empty: SearchResponse = { status: "NOT_FOUND", results: [], errors: [] }

describe("official original fallback", () => {
  it("reports an unavailable court source without turning it into no matching judgment", async () => {
    // Given
    const law = { search: async () => empty, getDetail: async () => empty }
    const court = {
      search: async (): Promise<SearchResponse> => {
        throw new Error("upstream blocked")
      },
    }
    // When
    const result = await searchWithCourtFallback(
      law,
      { query: "방산 지체상금 판례", types: ["precedent"] },
      court,
    )
    // Then
    expect("officialCourt" in result && result.officialCourt.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
  })
  it("returns a court original when exact docket is not exposed by the Law API", async () => {
    // Given
    const requests: LegalSearchInput[] = []
    const law = {
      search: async (input: LegalSearchInput) => {
        requests.push(input)
        return empty
      },
      getDetail: async () => empty,
    }
    const courtRequests: LegalSearchInput[] = []
    const court = {
      search: async (input: LegalSearchInput): Promise<SearchResponse> => {
        courtRequests.push(input)
        return {
          status: "OK",
          errors: [],
          results: [
            {
              id: "court:2:111:file.pdf",
              documentId: "court:2:111:file.pdf",
              source: "대법원 공식 판결문",
              sourceType: "precedent",
              title: "물품대금",
              summary: "2020다12345",
              status: "unknown",
              verified: true,
              sourceUrl:
                "https://www.scourt.go.kr/portal/news/NewsViewAction.work?gubun=2&seqnum=111",
              retrievedAt: "2026-10-31",
              content: JSON.stringify({ 판례내용: "지체상금 감액 판단. 국가계약법상 이자 약정." }),
            },
          ],
        }
      },
    }
    // When
    const result = await searchWithCourtFallback(
      law,
      { query: "방산 지체상금 판례를 알려줘", types: ["precedent"], timeBudgetMs: 25_000 },
      court,
    )
    // Then
    expect(result.results.some((hit) => hit.document.documentId.startsWith("court:"))).toBe(true)
    expect(requests.some((input) => input.caseNumber === "2020다12345")).toBe(true)
    expect(courtRequests).toHaveLength(1)
    expect(result.answerEvidence.decision).toBe("partial")
  })
  it("does not expand an explicitly statute-only request into court sources", async () => {
    // Given
    let called = false
    const law = { search: async () => empty, getDetail: async () => empty }
    const court = {
      search: async () => {
        called = true
        return empty
      },
    }
    // When
    await searchWithCourtFallback(law, { query: "지체상금 규정", types: ["law"] }, court)
    // Then
    expect(called).toBe(false)
  })
})
