import { afterEach, describe, expect, it } from "vitest"
import { LawApiProvider } from "../src/providers/law/law-api-provider.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("official list coverage", () => {
  it("keeps pagination open when one administrative stream has more pages", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const history = new URL(request.url ?? "/", "http://localhost").searchParams.get("nw") === "2"
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          AdmRulSearch: {
            totalCnt: history ? "1" : "300",
            admrul: [
              {
                행정규칙일련번호: history ? "old" : "current",
                행정규칙명: "방위사업규정",
                현행연혁구분: history ? "연혁" : "현행",
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
      query: "방위사업",
      types: ["administrative_rule"],
      currentOnly: false,
      page: 2,
      limit: 100,
    })
    // Then
    expect(result.coverage?.pages[0]).toMatchObject({
      totalCount: 301,
      fetchedCount: 2,
      hasMore: true,
      nextPage: 3,
    })
  })
  it("reports next page when a temporal filter removes every fetched item", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "250",
            law: Array.from({ length: 100 }, (_, index) => ({
              법령일련번호: String(index),
              법령명한글: "예정법",
              시행일자: "29990101",
              현행연혁코드: "현행",
            })),
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    // When
    const result = await provider.search({ query: "예정법", limit: 100 })
    // Then
    expect(result.results).toHaveLength(0)
    expect(result.coverage?.pages[0]).toMatchObject({
      sourceType: "law",
      page: 1,
      pageSize: 100,
      totalCount: 250,
      fetchedCount: 100,
      hasMore: true,
      nextPage: 2,
    })
  })

  it("retains page metadata on cache hits and reports merged result truncation", async () => {
    // Given
    let calls = 0
    const api = await startFakeLawApi((_request, response) => {
      calls += 1
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "25",
            law: Array.from({ length: 20 }, (_, index) => ({
              법령일련번호: String(index),
              법령명한글: "방위사업법",
              현행연혁코드: "현행",
            })),
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    await provider.search({ query: "방위사업법", limit: 5 })
    // When
    const result = await provider.search({ query: "방위사업법", limit: 5 })
    // Then
    expect(calls).toBe(1)
    expect(result.coverage).toMatchObject({
      resultLimitReached: true,
      pages: [{ pageSize: 20, fetchedCount: 20, hasMore: true }],
    })
  })

  it("provides generic API pagination even when current results are empty", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "201",
            law: [
              {
                법령일련번호: "1",
                법령명한글: "예정법",
                시행일자: "29990101",
                현행연혁코드: "현행",
              },
            ],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    // When
    const result = await provider.query({ apiId: "law.list", query: "법", limit: 100, page: 2 })
    // Then
    expect(result.coverage).toMatchObject({
      page: 2,
      pageSize: 100,
      totalCount: 201,
      fetchedCount: 1,
      hasMore: true,
      nextPage: 3,
    })
  })
})
