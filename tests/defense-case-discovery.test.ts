import { afterEach, describe, expect, it } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { searchLegalContentParallel } from "../src/providers/law/parallel-content-search.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()))
})
describe("defense delay case discovery", () => {
  it.each([false, true])(
    "finds a generic-titled defense case when title search is empty=%s",
    async (emptyTitle) => {
      // Given
      const scopes: string[] = []
      const api = await startFakeLawApi((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        response.setHeader("content-type", "application/json")
        if (url.pathname === "/lawSearch.do") {
          scopes.push(url.searchParams.get("search") ?? "1")
          const body = url.searchParams.get("search") === "2"
          if (!body && emptyTitle) {
            response.end(JSON.stringify({ PrecSearch: { totalCnt: "0", prec: [] } }))
            return
          }
          response.end(
            JSON.stringify({
              PrecSearch: {
                totalCnt: "1",
                prec: [
                  {
                    판례일련번호: body ? "defense" : "general",
                    사건명: body ? "물품대금" : "지체상금",
                    사건번호: body ? "2020다11111" : "2025다22222",
                    선고일자: body ? "20200101" : "20250101",
                  },
                ],
              },
            }),
          )
        } else {
          const body = url.searchParams.get("ID") === "defense"
          response.end(
            JSON.stringify({
              PrecService: {
                사건명: body ? "물품대금" : "지체상금",
                사건번호: body ? "2020다11111" : "2025다22222",
                판결요지: body
                  ? "방위사업청 군수품 계약의 지체상금을 감액할 수 있다"
                  : "아파트 공사의 지체상금 판단",
              },
            }),
          )
        }
      })
      apis.push(api)
      const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
      // When
      const result = await searchLegalContentParallel(law, {
        query: "방산물자 납품계약에서 지체상금이 문제 된 판례 사례를 알려줘",
        types: ["precedent"],
      })
      // Then
      expect(scopes).toContain("2")
      expect(result.lanes.find((lane) => lane.name === "cases")?.coverage?.pages).toEqual(
        expect.arrayContaining([expect.objectContaining({ searchScope: "content" })]),
      )
      expect(result.results[0]?.document.documentId).toBe("defense")
      expect(result.answerEvidence.decision).toBe("partial")
    },
  )
})
