import { afterEach, describe, expect, it, vi } from "vitest"
import { LawApiProvider } from "../src/providers/law/law-api-provider.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

describe("current response cache boundary", () => {
  it("rechecks current list discovery after five minutes despite a longer configured TTL", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["Date"] })
    const state = { version: "1" }
    const api = await startFakeLawApi((_request, response) =>
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "1",
            law: {
              법령일련번호: state.version,
              법령명한글: "방위사업법",
              시행일자: "20200101",
              현행연혁코드: "현행",
            },
          },
        }),
      ),
    )
    apis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, cacheTtlMs: 3600000 })
    await provider.search({ query: "방위사업법" })
    state.version = "2"
    vi.advanceTimersByTime(300001)
    // When
    const result = await provider.search({ query: "방위사업법" })
    // Then
    expect(result.results[0]?.documentId).toBe("2")
  })
  it.each(["specialized", "generic"] as const)(
    "revalidates current mapping after five minutes with a long configured TTL in %s path",
    async (path) => {
      // Given
      vi.useFakeTimers({ toFake: ["Date"] })
      const state = { version: "1" }
      const requests: URL[] = []
      const api = await startFakeLawApi((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        requests.push(url)
        response.end(
          JSON.stringify(
            url.pathname === "/lawSearch.do"
              ? {
                  LawSearch: {
                    totalCnt: "1",
                    law: {
                      법령일련번호: state.version,
                      법령ID: "10107",
                      법령명한글: "방위사업법",
                      시행일자: "20200101",
                      현행연혁코드: "현행",
                    },
                  },
                }
              : {
                  법령: {
                    기본정보: { 법령명_한글: "방위사업법", 법령ID: "10107", 시행일자: "20200101" },
                    조문: {
                      조문단위: { 조문번호: "1", 조문내용: `본문 ${url.searchParams.get("MST")}` },
                    },
                  },
                },
          ),
        )
      })
      apis.push(api)
      const config = {
        apiKey: "test",
        baseUrl: api.baseUrl,
        retryLimit: 0,
        cacheTtlMs: 3_600_000,
        detailCacheTtlMs: 21_600_000,
      }
      const specialized = new LawProvider(config)
      const generic = new LawApiProvider(config)
      const query = () =>
        path === "specialized"
          ? specialized.getDetail({ sourceType: "law", documentId: "1" })
          : generic.query({ apiId: "law.detail", documentId: "1" })
      await query()
      state.version = "2"
      vi.advanceTimersByTime(300_001)
      // When
      const result = await query()
      // Then
      expect(result.status).toBe("OK")
      expect(requests.filter((url) => url.pathname === "/lawSearch.do")).toHaveLength(2)
      expect(requests.at(-1)?.searchParams.get("MST")).toBe("2")
    },
  )
})
