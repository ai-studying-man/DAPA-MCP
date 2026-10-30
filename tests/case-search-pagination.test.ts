import { describe, expect, it } from "vitest"
import { contentSearchCoverage } from "../src/providers/law/content-search-coverage.js"

describe("mixed title and body search coverage", () => {
  it.each([false, true])(
    "retains more pages across equal query/page with body first=%s",
    (bodyFirst) => {
      const page = {
        sourceType: "precedent" as const,
        query: "지체상금",
        searchScope: "title" as const,
        page: 1,
        pageSize: 30,
        totalCount: 30,
        fetchedCount: 30,
        hasMore: false,
      }
      const body = {
        ...page,
        searchScope: "content" as const,
        totalCount: 520,
        hasMore: true,
        nextPage: 2,
      }
      const pages = bodyFirst ? [body, page] : [page, body]
      const coverage = contentSearchCoverage({
        searches: pages.map((item) => ({
          status: "OK",
          results: [],
          errors: [],
          coverage: { pages: [item], resultLimitReached: false },
        })),
        candidateDocuments: 0,
        outcomes: [],
        returnedDocuments: 0,
        majorDocumentsOnly: false,
        omittedQueryVariants: 0,
      })
      expect(coverage.hasMorePages).toBe(true)
      expect(coverage.nextAction).toBe("expand_search")
    },
  )
})
