import { describe, expect, it } from "vitest"
import { searchLegalContent } from "../src/providers/law/content-search.js"
import { extractExcerptEvidence } from "../src/providers/law/content-search-evidence.js"
import type { DapaSearchResult, LegalDocumentDetail } from "../src/types/results.js"

const document: DapaSearchResult = {
  id: "1",
  documentId: "1",
  source: "test",
  sourceType: "law",
  title: "시험 기준",
  status: "current",
  verified: true,
  retrievedAt: "2026-10-06T00:00:00Z",
}
const detail: LegalDocumentDetail = {
  basicInfo: {},
  articles: Array.from({ length: 5 }, (_, i) => ({
    articleNumber: String(i + 1),
    text: "시험 절차",
  })),
  supplementaryProvisions: [],
  annexes: [],
  forms: [],
}

describe("bounded content coverage", () => {
  it("does not hydrate old candidate IDs twice when the body resolves a newer version", async () => {
    // Given
    const documents = Array.from({ length: 5 }, (_, i) => ({
      ...document,
      id: String(i),
      documentId: String(i),
    }))
    const requested: string[] = []
    const provider = {
      search: async () => ({ status: "OK" as const, results: documents, errors: [] }),
      getDetail: async (input: { readonly documentId: string }) => {
        requested.push(input.documentId)
        return {
          status: "OK" as const,
          results: [{ ...document, documentId: `new-${input.documentId}` }],
          detail: { ...detail, articles: [] },
          errors: [],
        }
      },
    }
    // When
    await searchLegalContent(provider, { query: "시험", types: ["law"], limit: 5 })
    // Then
    expect(new Set(requested).size).toBe(5)
    expect(requested).toHaveLength(5)
  })
  it("labels evidence with the current version resolved by the body API", async () => {
    // Given
    const latest = { ...document, id: "2", documentId: "2", effectiveDate: "2026-10-02" }
    const provider = {
      search: async () => ({ status: "OK" as const, results: [document], errors: [] }),
      getDetail: async () => ({
        status: "OK" as const,
        results: [{ ...latest, content: "raw official JSON" }],
        detail,
        errors: [],
      }),
    }
    // When
    const result = await searchLegalContent(provider, { query: "시험", types: ["law"], limit: 1 })
    // Then
    expect(result.results[0]?.document).toMatchObject({
      documentId: "2",
      effectiveDate: "2026-10-02",
    })
    expect(result.results[0]?.document.content).toBeUndefined()
  })
  it("discloses candidates clipped by the list result limit even without another page", async () => {
    // Given
    const provider = {
      search: async () => ({
        status: "OK" as const,
        results: [document],
        errors: [],
        coverage: {
          pages: [
            {
              sourceType: "law" as const,
              query: "시험",
              page: 1,
              pageSize: 100,
              totalCount: 100,
              fetchedCount: 100,
              hasMore: false,
            },
          ],
          resultLimitReached: true,
        },
      }),
      getDetail: async () => ({ status: "OK" as const, results: [document], detail, errors: [] }),
    }
    // When
    const result = await searchLegalContent(provider, { query: "시험", types: ["law"], limit: 1 })
    // Then
    expect(result.coverage).toMatchObject({
      discoveryResultLimitReached: true,
      nextAction: "expand_search",
    })
  })
  it("does not count a failed body retrieval as inspected evidence", async () => {
    // Given
    const provider = {
      search: async () => ({ status: "OK" as const, results: [document], errors: [] }),
      getDetail: async () => ({
        status: "SOURCE_UNAVAILABLE" as const,
        results: [],
        errors: [{ code: "TIMEOUT", message: "upstream" }],
      }),
    }
    // When
    const result = await searchLegalContent(provider, { query: "시험", types: ["law"], limit: 1 })
    // Then
    expect(result.coverage).toMatchObject({
      attemptedDocuments: 1,
      inspectedDocuments: 0,
      unavailableDocuments: 1,
      nextAction: "retry_sources",
    })
  })
  it("discloses both omitted excerpts and clipped text", () => {
    // Given
    const raw = JSON.stringify({
      판결요지: Array.from({ length: 7 }, (_, i) => `시험 ${i} ${"가".repeat(7000)}`),
    })
    // When
    const result = extractExcerptEvidence(raw, ["시험"])
    // Then
    expect(result.coverage).toEqual({ matchingSections: 7, returnedSections: 5, truncated: true })
    expect(result.excerpts[0]?.length).toBeLessThanOrEqual(6002)
  })
  it("reports omitted matching clauses instead of silently returning three", async () => {
    // Given
    const provider = {
      search: async () => ({ status: "OK" as const, results: [document], errors: [] }),
      getDetail: async () => ({ status: "OK" as const, results: [document], detail, errors: [] }),
    }
    // When
    const result = await searchLegalContent(provider, { query: "시험", types: ["law"] })
    // Then
    expect(result.results[0]).toMatchObject({
      evidenceCoverage: { matchingSections: 5, returnedSections: 3, truncated: true },
    })
  })

  it("reports candidates whose bodies were not checked in fast mode", async () => {
    // Given
    const documents = Array.from({ length: 5 }, (_, i) => ({
      ...document,
      id: String(i),
      documentId: String(i),
    }))
    const provider = {
      search: async () => ({ status: "OK" as const, results: documents, errors: [] }),
      getDetail: async () => ({ status: "OK" as const, results: [document], detail, errors: [] }),
    }
    // When
    const result = await searchLegalContent(provider, { query: "시험", types: ["law"], limit: 5 })
    // Then
    expect(result).toMatchObject({
      coverage: {
        candidateDocuments: 5,
        inspectedDocuments: 3,
        remainingCandidates: 2,
        exhaustive: false,
      },
    })
  })
})
