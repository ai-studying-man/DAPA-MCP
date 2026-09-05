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
              조문: { 조문단위: [{ 조문번호: "3의2", 조문제목: "청렴서약제" }] },
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
    const results = await verifier.verify(["방위사업법 제3조의2"])

    // Then
    expect(results[0]).toMatchObject({
      citation: "방위사업법 제3조의2",
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

  it("rejects a real article number paired with the wrong article title", async () => {
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
            law: [{ 법령일련번호: "276787", 법령명한글: "방위사업법" }],
          },
        }),
      )
    })
    openApis.push(api)
    const verifier = new CitationVerifier(
      new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }),
    )

    // When
    const results = await verifier.verify(["방위사업법 제3조(계약해제)"])

    // Then
    expect(results[0]?.status).toBe("CONTENT_MISMATCH")
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
    const results = await verifier.verify(["방위사업법 제3조의2"])

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

  it("verifies a DAPA administrative-rule article through the administrative-rule API", async () => {
    // Given
    const requestedTargets: string[] = []
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      requestedTargets.push(url.searchParams.get("target") ?? "")
      response.setHeader("content-type", "application/json")
      if (url.pathname.endsWith("lawService.do")) {
        response.end(
          JSON.stringify({
            행정규칙: {
              행정규칙명: "방위사업관리규정",
              기본정보: { 법령명_한글: "방위사업관리규정", 법령ID: "38163" },
              조문: { 조문단위: [{ 조문번호: "12", 조문제목: "사업관리" }] },
            },
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          AdmRulSearch: {
            totalCnt: "1",
            admrul: [{ 행정규칙일련번호: "38163", 행정규칙명: "방위사업관리규정" }],
          },
        }),
      )
    })
    openApis.push(api)
    const verifier = new CitationVerifier(
      new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }),
    )

    // When
    const results = await verifier.verify(["방위사업관리규정 제12조"])

    // Then
    expect(results[0]?.status).toBe("VERIFIED")
    expect(requestedTargets).toEqual(["admrul", "admrul"])
  })

  it("verifies a Constitutional Court case through the constitutional-case API", async () => {
    // Given
    let requestedTarget = ""
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      requestedTarget = url.searchParams.get("target") ?? ""
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          DetcSearch: {
            totalCnt: "1",
            Detc: [
              {
                헌재결정례일련번호: "12345",
                사건명: "위헌소원",
                사건번호: "2020헌바123",
              },
            ],
          },
        }),
      )
    })
    openApis.push(api)
    const verifier = new CitationVerifier(
      new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }),
    )

    // When
    const results = await verifier.verify(["헌법재판소 2020헌바123"])

    // Then
    expect(results[0]?.status).toBe("VERIFIED")
    expect(requestedTarget).toBe("detc")
  })
})
