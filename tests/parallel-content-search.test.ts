import { describe, expect, it } from "vitest"
import { planCaseSearch } from "../src/providers/law/case-search-plan.js"
import type { LawProvider } from "../src/providers/law/law-provider.js"
import { searchLegalContentParallel } from "../src/providers/law/parallel-content-search.js"
import type { DapaSearchResult } from "../src/types/results.js"

describe("parallel legal and case discovery", () => {
  it("places body-confirmed defense cases before general comparative cases", async () => {
    // Given
    const document = (id: string, date: string): DapaSearchResult => ({
      id,
      documentId: id,
      source: "law",
      sourceType: "precedent",
      title: "입찰참가자격제한",
      date,
      status: "unknown",
      verified: true,
      retrievedAt: "2026-10-07",
    })
    const law: Pick<LawProvider, "search" | "getDetail"> = {
      search: async () => ({
        status: "OK",
        results: [document("general", "2025-01-01"), document("defense", "2024-06-27")],
        errors: [],
      }),
      getDetail: async (input) => ({
        status: "OK",
        results: [
          {
            ...document(input.documentId, "2024-06-27"),
            content: JSON.stringify({
              판결이유: `${input.documentId === "defense" ? "방위사업청장" : "지방자치단체"} 입찰참가자격제한 처분`,
            }),
          },
        ],
        errors: [],
      }),
    }
    // When
    const result = await searchLegalContentParallel(law, {
      query: "입찰참가자격제한 판례",
      types: ["precedent"],
    })
    // Then
    expect(result.results.map((hit) => hit.document.documentId)).toEqual(["defense", "general"])
  })
  it("retains the original defense cost topic for primary document routing", () => {
    // Given / When
    const plan = planCaseSearch("방산원가가 뭐야?")
    // Then
    expect(plan.legalQuery).toBe("방산원가가 뭐야?")
  })
  it("honors an explicit one-case quota and prioritizes the newer issue match", async () => {
    // Given
    const document = (id: string, date: string): DapaSearchResult => ({
      id,
      documentId: id,
      source: "law",
      sourceType: "precedent",
      title: "입찰참가자격제한",
      date,
      status: "unknown",
      verified: true,
      retrievedAt: "2026-10-07",
    })
    const ids: string[] = []
    const law: Pick<LawProvider, "search" | "getDetail"> = {
      search: async () => ({
        status: "OK",
        results: [document("old", "2024-01-01"), document("new", "2024-06-27")],
        errors: [],
      }),
      getDetail: async (input) => {
        ids.push(input.documentId)
        return {
          status: "OK",
          results: [
            {
              ...document(input.documentId, "2024-06-27"),
              content: JSON.stringify({ 판결이유: "입찰참가자격제한 처분" }),
            },
          ],
          errors: [],
        }
      },
    }
    // When
    await searchLegalContentParallel(law, {
      query: "입찰참가자격제한 판례",
      types: ["precedent"],
      limit: 1,
    })
    // Then
    expect(ids).toEqual(["new"])
  })

  it("reports unavailable when both attempted lanes fail", async () => {
    // Given
    const law: Pick<LawProvider, "search" | "getDetail"> = {
      search: async () => ({
        status: "SOURCE_UNAVAILABLE",
        results: [],
        errors: [{ code: "TIMEOUT", message: "timeout" }],
      }),
      getDetail: async () => ({ status: "NOT_FOUND", results: [], errors: [] }),
    }
    // When
    const result = await searchLegalContentParallel(law, { query: "납품 규격 미달 사례" })
    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
  })

  it("marks a bare case request as unsearched instead of proving absence", async () => {
    // Given
    const law: Pick<LawProvider, "search" | "getDetail"> = {
      search: async () => ({ status: "NOT_FOUND", results: [], errors: [] }),
      getDetail: async () => ({ status: "NOT_FOUND", results: [], errors: [] }),
    }
    // When
    const result = await searchLegalContentParallel(law, { query: "방위사업청 사례 알려줘" })
    // Then
    expect(result.lanes.find((lane) => lane.name === "cases")).toMatchObject({
      searched: false,
      reason: "insufficient_query",
    })
  })
  it("verifies issue evidence and defense context in a past case body", async () => {
    // Given
    const document: DapaSearchResult = {
      id: "case",
      documentId: "case",
      source: "law",
      sourceType: "precedent",
      title: "입찰참가자격제한",
      date: "2024-06-27",
      status: "unknown",
      verified: true,
      retrievedAt: "2026-10-07",
    }
    const detailInputs: boolean[] = []
    const law: Pick<LawProvider, "search" | "getDetail"> = {
      search: async (input) => ({
        status: "OK",
        results: input.types?.includes("precedent") ? [document] : [],
        errors: [],
      }),
      getDetail: async (input) => {
        detailInputs.push(input.currentOnly ?? true)
        return {
          status: "OK",
          results: [
            {
              ...document,
              content: JSON.stringify({
                판결이유: "방위사업청장의 입찰참가자격제한 처분은 부정한 제조가 쟁점이다.",
              }),
            },
          ],
          errors: [],
        }
      },
    }
    // When
    const result = await searchLegalContentParallel(law, {
      query: "납품 품질 미달 제재 사례",
      asOfDate: "2026-10-07",
    })
    // Then
    expect(result.results[0]?.caseRelevance).toBe("direct_defense")
    expect(result.results[0]?.document.date).toBe("2024-06-27")
    expect(detailInputs).toEqual([false])
  })

  it("does not use a bare agency and case request as an issue query", () => {
    // Given / When
    const plan = planCaseSearch("방위사업청 사례 알려줘")
    // Then
    expect(plan.searchQueries).toEqual([])
  })
  it("expands delivery quality disputes into legal issues", () => {
    // Given / When
    const plan = planCaseSearch("납품한 물품의 규격이 미달하면 업체를 제재할 수 있어?")
    // Then
    expect(plan.searchQueries).toEqual(expect.arrayContaining(["입찰참가자격제한", "부정한 제조"]))
  })

  it("starts both lanes before either resolves with one deadline", async () => {
    // Given
    const types = new Set<string>()
    const deadlines = new Set<number | undefined>()
    let release: (() => void) | undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const law: Pick<LawProvider, "search" | "getDetail"> = {
      search: async (input) => {
        for (const type of input.types ?? []) types.add(type)
        deadlines.add(input.deadlineAt)
        if (types.has("law") && types.has("precedent")) release?.()
        await barrier
        return { status: "NOT_FOUND", results: [], errors: [] }
      },
      getDetail: async () => ({ status: "NOT_FOUND", results: [], errors: [] }),
    }
    // When
    const result = await searchLegalContentParallel(law, { query: "납품 규격 미달 사례" })
    // Then
    expect(result.lanes).toHaveLength(2)
    expect(deadlines.size).toBe(1)
    expect(result.status).toBe("NOT_FOUND")
  })

  it("honors explicit source types without adding precedents", async () => {
    // Given
    const types: string[] = []
    const law: Pick<LawProvider, "search" | "getDetail"> = {
      search: async (input) => {
        types.push(...(input.types ?? []))
        return { status: "NOT_FOUND", results: [], errors: [] }
      },
      getDetail: async () => ({ status: "NOT_FOUND", results: [], errors: [] }),
    }
    // When
    await searchLegalContentParallel(law, { query: "관련 판례 사례", types: ["law"] })
    // Then
    expect(types).not.toContain("precedent")
  })

  it("reports a case API failure separately from an empty law lane", async () => {
    // Given
    const law: Pick<LawProvider, "search" | "getDetail"> = {
      search: async (input) =>
        input.types?.includes("precedent")
          ? {
              status: "SOURCE_UNAVAILABLE",
              results: [],
              errors: [{ code: "TIMEOUT", message: "timeout" }],
            }
          : { status: "NOT_FOUND", results: [], errors: [] },
      getDetail: async () => ({ status: "NOT_FOUND", results: [], errors: [] }),
    }
    // When
    const result = await searchLegalContentParallel(law, { query: "납품 규격 미달 사례" })
    // Then
    expect(result.status).toBe("PARTIAL_RESULT")
    expect(result.lanes.find((lane) => lane.name === "cases")?.status).toBe("SOURCE_UNAVAILABLE")
  })
})
