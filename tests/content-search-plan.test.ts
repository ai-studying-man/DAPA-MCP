import { describe, expect, it } from "vitest"
import {
  expandSearchQueries,
  inferLegalSourceTypes,
  planContentSearch,
  rankCandidates,
} from "../src/providers/law/content-search-plan.js"
import type { DapaSearchResult } from "../src/types/results.js"

describe("inferLegalSourceTypes", () => {
  it("routes an ordinance question to local-ordinance data without model assistance", () => {
    // Given
    const query = "지방자치단체의 방위산업 육성 조례에서 지원할 수 있는 사업은 무엇인가?"

    // When
    const types = inferLegalSourceTypes(query)

    // Then
    expect(types).toEqual(["local_ordinance"])
  })

  it("keeps law and administrative rules as the default for a general DAPA question", () => {
    // Given
    const query = "무기체계 시험평가 절차는 어떻게 진행하나요?"

    // When
    const types = inferLegalSourceTypes(query)

    // Then
    expect(types).toEqual(["law", "administrative_rule"])
  })

  it("does not add a law search when the question specifically asks for an interpretation", () => {
    // Given
    const query = "방위사업 계약에 관한 법령해석례를 찾아줘"

    // When
    const types = inferLegalSourceTypes(query)

    // Then
    expect(types).toEqual(["interpretation"])
  })
})

describe("expandSearchQueries", () => {
  it("prefers a DAPA legal term over generic court wording", () => {
    // Given
    const question = "방위사업법 또는 방위사업청과 관련된 헌법재판소결정례를 알려줘"

    // When
    const queries = expandSearchQueries(question)

    // Then
    expect(queries[0]).toBe("방위사업법")
  })

  it.each([
    ["방위사업법 청렴서약 제재", "청렴서약"],
    ["절충교역 적용 근거와 기준", "절충교역"],
    ["야전운용시험 절차 후속조치", "야전운용시험"],
  ])("prefers the issue term in %s", (question, expected) => {
    // Given
    const input = question

    // When
    const queries = expandSearchQueries(input)

    // Then
    expect(queries[0]).toBe(expected)
  })

  it("uses agency context for discovery but not as substantive evidence", () => {
    // Given
    const question = "방위사업청 물품적격심사기준 부칙 위헌"

    // When
    const plan = planContentSearch(question)

    // Then
    expect(plan.evidenceQueries).toEqual(["물품적격심사기준", "부칙", "위헌"])
    expect(plan.searchQueries.slice(0, 2)).toEqual(["물품적격심사기준", "부칙"])
  })

  it.each(["방위사업청", "방사청"])("excludes %s from contract evidence", (agency) => {
    // Given
    const question = `${agency}에서 중도확정계약을 알려줘`
    // When
    const plan = planContentSearch(question)
    // Then
    expect(plan.evidenceQueries).toEqual(["중도확정계약"])
    expect(plan.searchQueries.slice(0, 2)).not.toContain(agency)
  })

  it("keeps an explicit document title discoverable without treating it as issue evidence", () => {
    // Given
    const question = "방위사업관리규정 예산편성"
    // When
    const plan = planContentSearch(question)
    // Then
    expect(plan.searchQueries.slice(0, 2)).toEqual(["예산편성", "방위사업관리규정"])
    expect(plan.evidenceQueries).toEqual(["예산편성"])
  })

  it("retains a document-only query without inventing a substantive issue", () => {
    // Given
    const question = "방위사업법"
    // When
    const plan = planContentSearch(question)
    // Then
    expect(plan.searchQueries[0]).toBe(question)
    expect(plan.evidenceQueries).toEqual([question])
  })

  it("prioritizes defense candidates before unrelated exact issue titles without excluding them", () => {
    // Given
    const candidate = (
      documentId: string,
      title: string,
      organization?: string,
    ): DapaSearchResult => ({
      id: documentId,
      documentId,
      title,
      source: "official",
      sourceType: "administrative_rule",
      ...(organization === undefined ? {} : { organization }),
      status: "unknown",
      verified: true,
      retrievedAt: "2026-10-06T00:00:00.000Z",
    })
    // When
    const ranked = rankCandidates(
      [
        candidate("other", "시험평가", "타기관"),
        candidate("mod", "시험평가 기준", "국방부"),
        candidate("title", "국방전력발전업무훈령"),
        candidate("dapa", "획득업무 지침", "방위사업청"),
      ],
      ["시험평가"],
    )
    // Then
    expect(ranked.map(({ documentId }) => documentId)).toEqual(["title", "dapa", "mod", "other"])
  })

  it("adds document-title relevance to DAPA organization relevance", () => {
    // Given
    const candidate = (documentId: string, title: string): DapaSearchResult => ({
      id: documentId,
      documentId,
      title,
      source: "official",
      sourceType: "administrative_rule",
      organization: "방위사업청",
      status: "unknown",
      verified: true,
      retrievedAt: "2026-09-05T00:00:00.000Z",
    })

    // When
    const ranked = rankCandidates(
      [candidate("generic", "군수품조달관리규정"), candidate("dapa", "방위사업관리규정")],
      ["야전운용시험"],
    )

    // Then
    expect(ranked[0]?.documentId).toBe("dapa")
  })

  it("prefers the closest title when several titles contain the issue term", () => {
    // Given
    const candidate = (documentId: string, title: string): DapaSearchResult => ({
      id: documentId,
      documentId,
      title,
      source: "official",
      sourceType: "administrative_rule",
      organization: "방위사업청",
      status: "unknown",
      verified: true,
      retrievedAt: "2026-09-05T00:00:00.000Z",
    })

    // When
    const ranked = rankCandidates(
      [
        candidate("narrow", "절충교역 획득자산의 기술료 및 대부료 징수요율에 관한 고시"),
        candidate("general", "절충교역 지침"),
      ],
      ["절충교역"],
    )

    // Then
    expect(ranked[0]?.documentId).toBe("general")
  })
})
