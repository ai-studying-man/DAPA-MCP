import { afterEach, describe, expect, it, vi } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { LawSearchCache } from "../src/providers/law/law-search-cache.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

describe("search cache performance", () => {
  it.each([300_000, 5_000])(
    "caches confirmed empty results for at most 30 seconds with TTL %i",
    async (ttl) => {
      // Given
      vi.useFakeTimers()
      const cache = new LawSearchCache(ttl)
      const loader = vi.fn(async () => [])
      await cache.getOrLoad("empty", false, loader)
      // When
      await cache.getOrLoad("empty", false, loader)
      expect(loader).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(Math.min(ttl, 30_000))
      await cache.getOrLoad("empty", false, loader)
      // Then
      expect(loader).toHaveBeenCalledTimes(2)
    },
  )

  it("does not cache rejected requests and allows a successful retry", async () => {
    // Given
    const cache = new LawSearchCache(300_000)
    const loader = vi.fn(async () => [])
    loader.mockRejectedValueOnce(new Error("upstream failure"))
    // When
    await expect(cache.getOrLoad("empty", false, loader)).rejects.toThrow("upstream failure")
    await cache.getOrLoad("empty", false, loader)
    await cache.getOrLoad("empty", false, loader)
    // Then
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it("coalesces empty requests per key while forceRefresh bypasses settled cache", async () => {
    // Given
    const cache = new LawSearchCache(300_000)
    const loader = vi.fn(async () => [])
    // When
    await Promise.all([
      cache.getOrLoad("one", false, loader),
      cache.getOrLoad("one", true, loader),
      cache.getOrLoad("two", false, loader),
    ])
    await cache.getOrLoad("one", false, loader)
    expect(loader).toHaveBeenCalledTimes(2)
    await cache.getOrLoad("one", true, loader)
    // Then
    expect(loader).toHaveBeenCalledTimes(3)
  })

  it("reuses actual upstream display pages without losing requested result counts", async () => {
    // Given
    const requests: URL[] = []
    const api = await startFakeLawApi((request, response) => {
      requests.push(new URL(request.url ?? "/", "http://localhost"))
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "20",
            law: Array.from({ length: 20 }, (_, index) => ({
              법령일련번호: String(index),
              법령명한글: `방위사업법 ${index}`,
              현행연혁코드: "현행",
            })),
          },
        }),
      )
    })
    apis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    // When
    const small = await provider.search({ query: "방위사업", limit: 5 })
    const large = await provider.search({ query: "방위사업", limit: 10 })
    await provider.search({ query: "방위사업", limit: 21 })
    await provider.search({ query: "방위사업", limit: 10, page: 2 })
    await provider.search({ query: "방위사업", limit: 10, searchScope: "content" })
    await provider.search({ query: "방위사업", limit: 10, currentOnly: false })
    // Then
    expect(small.results).toHaveLength(5)
    expect(large.results).toHaveLength(10)
    expect(requests.map((url) => url.searchParams.get("display"))).toEqual([
      "20",
      "21",
      "20",
      "20",
      "20",
    ])
  })

  it.each(["http", "malformed", "missing-items"] as const)(
    "does not cache %s failures as empty results",
    async (failure) => {
      // Given
      let calls = 0
      const api = await startFakeLawApi((_request, response) => {
        calls += 1
        response.setHeader("content-type", "application/json")
        if (calls === 1) {
          if (failure === "http") response.statusCode = 503
          response.end(
            failure === "malformed"
              ? "invalid JSON"
              : JSON.stringify({ LawSearch: { totalCnt: "1", law: [] } }),
          )
          return
        }
        response.end(JSON.stringify({ LawSearch: { totalCnt: "0", law: [] } }))
      })
      apis.push(api)
      const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
      // When
      const failed = await provider.search({ query: "방위사업" })
      const recovered = await provider.search({ query: "방위사업" })
      await provider.search({ query: "방위사업" })
      // Then
      expect(failed.status).toBe("SOURCE_UNAVAILABLE")
      expect(recovered.status).toBe("NOT_FOUND")
      expect(calls).toBe(2)
    },
  )
})
