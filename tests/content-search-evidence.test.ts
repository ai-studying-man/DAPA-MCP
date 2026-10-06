import { describe, expect, it } from "vitest"
import {
  extractMatchingExcerpts,
  selectMatchingDetail,
} from "../src/providers/law/content-search-evidence.js"
import type { LegalDocumentDetail } from "../src/types/results.js"

describe("extractMatchingExcerpts", () => {
  it("prevents a future article from re-entering evidence through raw text fallback", () => {
    // Given
    const rawContent = JSON.stringify({
      법령: {
        조문: {
          조문단위: [
            { 조문번호: "1", 조문내용: "중도확정계약 시행 예정 내용", 조문시행일자: "29990101" },
          ],
        },
      },
    })
    // When
    const current = extractMatchingExcerpts(rawContent, ["중도확정계약"], "2026-10-06")
    const explicitVersion = extractMatchingExcerpts(rawContent, ["중도확정계약"])
    // Then
    expect(current).toEqual([])
    expect(explicitVersion).toEqual(["중도확정계약 시행 예정 내용"])
  })
  it("excludes a future-dated provision from today's evidence while retaining explicit version access", () => {
    // Given
    const detail: LegalDocumentDetail = {
      basicInfo: {},
      articles: [
        { articleNumber: "1", text: "중도확정계약 시행 예정 내용", effectiveDate: "2999-01-01" },
      ],
      supplementaryProvisions: [],
      annexes: [],
      forms: [],
    }
    // When
    const current = selectMatchingDetail(detail, ["중도확정계약"], "2026-10-06")
    const explicitVersion = selectMatchingDetail(detail, ["중도확정계약"])
    // Then
    expect(current).toBeUndefined()
    expect(explicitVersion?.articles).toHaveLength(1)
  })
  it("rejects an official API menu placeholder as body evidence", () => {
    // Given
    const rawContent = JSON.stringify({
      AdmRulService: {
        조문내용:
          '「절충교역 지침」의 자세한 내용은 상단 메뉴 "<img id="40425753"></img>"버튼을 이용하십시오.',
      },
    })

    // When
    const excerpts = extractMatchingExcerpts(rawContent, ["절충교역"])

    // Then
    expect(excerpts).toEqual([])
  })
})
