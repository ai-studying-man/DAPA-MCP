import { afterEach, describe, expect, it } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("Law HTTP concurrency", () => {
  it("expires a queued request at the shared total deadline", async () => {
    // Given
    let releaseFirst: (() => void) | undefined
    let firstStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const api = await startFakeLawApi((_request, response) => {
      firstStarted?.()
      releaseFirst = () => {
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            법령: {
              기본정보: { 법령명_한글: "방위사업법" },
              조문: { 조문단위: [{ 조문번호: "1", 조문내용: "목적" }] },
            },
          }),
        )
      }
    })
    openApis.push(api)
    const law = new LawProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
      maxConcurrency: 1,
    })
    const first = law.getDetail({ documentId: "first", sourceType: "law" })
    await started

    // When
    const queued = await law.getDetail({
      documentId: "queued",
      sourceType: "law",
      deadlineAt: Date.now() + 20,
    })

    // Then
    expect(queued.status).toBe("SOURCE_UNAVAILABLE")
    expect(queued.errors[0]?.code).toBe("TIMEOUT")
    releaseFirst?.()
    await first
  })

  it("rejects excess work instead of building an unbounded employee request queue", async () => {
    // Given
    let requestCount = 0
    let releaseFirst: (() => void) | undefined
    let firstStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const api = await startFakeLawApi((_request, response) => {
      requestCount += 1
      const finish = () => {
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            법령: {
              기본정보: { 법령명_한글: "방위사업법" },
              조문: { 조문단위: [{ 조문번호: "1", 조문내용: "목적" }] },
            },
          }),
        )
      }
      if (requestCount === 1) {
        firstStarted?.()
        releaseFirst = finish
        return
      }
      finish()
    })
    openApis.push(api)
    const law = new LawProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
      maxConcurrency: 1,
      maxQueue: 1,
    })
    const first = law.getDetail({ documentId: "first", sourceType: "law" })
    await started
    const second = law.getDetail({ documentId: "second", sourceType: "law" })

    // When
    const excess = await law.getDetail({ documentId: "excess", sourceType: "law" })

    // Then
    expect(excess.status).toBe("SOURCE_UNAVAILABLE")
    expect(excess.errors[0]?.code).toBe("RATE_LIMITED")
    releaseFirst?.()
    await Promise.all([first, second])
  })

  it("lets each employee stop waiting for a coalesced search at their own deadline", async () => {
    // Given
    let searchStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      searchStarted = resolve
    })
    const api = await startFakeLawApi((_request, response) => {
      searchStarted?.()
      setTimeout(() => {
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            LawSearch: {
              totalCnt: "1",
              law: [{ 법령일련번호: "1", 법령명한글: "방위사업법", 현행연혁코드: "현행" }],
            },
          }),
        )
      }, 100)
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    const first = law.search({ query: "방위사업법", types: ["law"] })
    await started

    // When
    const waitingStartedAt = Date.now()
    const second = await law.search({
      query: "방위사업법",
      types: ["law"],
      deadlineAt: Date.now() + 20,
    })

    // Then
    expect(second.status).toBe("SOURCE_UNAVAILABLE")
    expect(second.errors[0]?.code).toBe("TIMEOUT")
    expect(Date.now() - waitingStartedAt).toBeLessThan(80)
    expect((await first).status).toBe("OK")
  })

  it("lets each employee stop waiting for a coalesced detail at their own deadline", async () => {
    // Given
    let detailStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      detailStarted = resolve
    })
    const api = await startFakeLawApi((_request, response) => {
      detailStarted?.()
      setTimeout(() => {
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            법령: {
              기본정보: { 법령명_한글: "방위사업법" },
              조문: { 조문단위: [{ 조문번호: "1", 조문내용: "목적" }] },
            },
          }),
        )
      }, 100)
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    const first = law.getDetail({ documentId: "1", sourceType: "law" })
    await started

    // When
    const waitingStartedAt = Date.now()
    const second = await law.getDetail({
      documentId: "1",
      sourceType: "law",
      deadlineAt: Date.now() + 20,
    })

    // Then
    expect(second.status).toBe("SOURCE_UNAVAILABLE")
    expect(second.errors[0]?.code).toBe("TIMEOUT")
    expect(Date.now() - waitingStartedAt).toBeLessThan(80)
    expect((await first).status).toBe("OK")
  })

  it("bounds simultaneous upstream requests across providers in one server process", async () => {
    // Given
    let activeRequests = 0
    let maximumActiveRequests = 0
    const api = await startFakeLawApi((_request, response) => {
      activeRequests += 1
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
      setTimeout(() => {
        activeRequests -= 1
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            법령: {
              기본정보: { 법령명_한글: "방위사업법" },
              조문: { 조문단위: [{ 조문번호: "1", 조문내용: "목적" }] },
            },
          }),
        )
      }, 10)
    })
    openApis.push(api)
    const firstProvider = new LawProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
      maxConcurrency: 2,
    })
    const secondProvider = new LawProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
      maxConcurrency: 2,
    })

    // When
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 === 0 ? firstProvider : secondProvider).getDetail({
          documentId: String(index),
          sourceType: "law",
        }),
      ),
    )

    // Then
    expect(results.every((result) => result.status === "OK")).toBe(true)
    expect(maximumActiveRequests).toBe(2)
  })
})
