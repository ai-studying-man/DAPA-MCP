import { afterEach, describe, expect, it } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("LawProvider search quality", () => {
  it("ranks an exact document title ahead of fuzzy title matches", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(Number(url.searchParams.get("display"))).toBeGreaterThanOrEqual(20)
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          AdmRulSearch: {
            totalCnt: "2",
            admrul: [
              { 행정규칙일련번호: "1", 행정규칙명: "방위사업관리규정 시행지침" },
              { 행정규칙일련번호: "2", 행정규칙명: "방위사업관리규정" },
            ],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({
      query: "방위사업관리규정",
      types: ["administrative_rule"],
      limit: 1,
    })

    // Then
    expect(result.results.map(({ documentId }) => documentId)).toEqual(["2"])
  })

  it("parses constitutional-case content search results from the official item key", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.searchParams.get("search")).toBe("2")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          DetcSearch: {
            totalCnt: "1",
            Detc: [
              {
                헌재결정례일련번호: "189479",
                사건명: "고고도미사일방어체계 배치 승인 위헌확인",
                사건번호: "2017헌마371",
                종국일자: "20240328",
              },
            ],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({
      query: "방위사업법",
      types: ["constitutional_case"],
      searchScope: "content",
      limit: 5,
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.results[0]).toMatchObject({
      documentId: "189479",
      sourceType: "constitutional_case",
      summary: "2017헌마371",
    })
  })
})
