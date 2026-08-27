import { afterEach, describe, expect, it } from "vitest"
import { CitationVerifier } from "../src/providers/law/citation-verifier.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("CitationVerifier", () => {
  it("verifies an existing law article against retrieved official content", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname.endsWith("lawService.do")) {
        response.end(
          JSON.stringify({
            법령: {
              기본정보: { 법령명_한글: "방위사업법", 법령ID: "009822" },
              조문: { 조문단위: [{ 조문번호: "3", 조문제목: "정의" }] },
            },
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          LawSearch: {
            target: "law",
            totalCnt: "1",
            law: [
              {
                법령일련번호: "276787",
                법령명한글: "방위사업법",
                현행연혁코드: "현행",
                법령상세링크: "/법령/방위사업법",
              },
            ],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    const verifier = new CitationVerifier(provider)

    // When
    const results = await verifier.verify(["방위사업법 제3조"])

    // Then
    expect(results[0]).toMatchObject({
      citation: "방위사업법 제3조",
      status: "VERIFIED",
      documentId: "276787",
    })
  })

  it("returns NOT_FOUND only for a completed zero-result search", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ LawSearch: { target: "law", totalCnt: "0", law: [] } }))
    })
    openApis.push(api)
    const verifier = new CitationVerifier(
      new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }),
    )

    // When
    const results = await verifier.verify(["존재하지않는법 제1조"])

    // Then
    expect(results[0]?.status).toBe("NOT_FOUND")
  })

  it("returns SOURCE_UNAVAILABLE when verification cannot reach the source", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.statusCode = 503
      response.end("unavailable")
    })
    openApis.push(api)
    const verifier = new CitationVerifier(
      new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }),
    )

    // When
    const results = await verifier.verify(["방위사업법 제3조"])

    // Then
    expect(results[0]?.status).toBe("SOURCE_UNAVAILABLE")
  })

  it("keeps unsupported prose explicitly unverified", async () => {
    // Given
    const verifier = new CitationVerifier(new LawProvider({}))

    // When
    const results = await verifier.verify(["아마 관련 규정이 있을 것입니다"])

    // Then
    expect(results[0]?.status).toBe("UNVERIFIED")
  })
})
