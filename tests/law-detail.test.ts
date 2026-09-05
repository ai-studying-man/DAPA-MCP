import { afterEach, describe, expect, it } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("LawProvider.getDetail", () => {
  it("retrieves official detail by document ID", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.pathname).toBe("/lawService.do")
      expect(url.searchParams.get("target")).toBe("law")
      expect(url.searchParams.get("MST")).toBe("276787")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          법령: {
            기본정보: {
              법령명_한글: "방위사업법",
              법령ID: "009822",
              시행일자: "20260701",
              법령상세링크: "https://www.law.go.kr?OC=detail-secret",
            },
            조문: { 조문단위: [{ 조문번호: "3", 조문제목: "정의" }] },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.getDetail({ documentId: "276787", sourceType: "law" })

    // Then
    expect(result.status).toBe("OK")
    expect(result.results[0]).toMatchObject({
      title: "방위사업법",
      documentId: "276787",
      verified: true,
    })
    expect(result.results[0]?.content).toContain("조문번호")
    expect(result.results[0]?.content).not.toContain("detail-secret")
    expect(result.detail?.basicInfo.title).toBe("방위사업법")
    expect(result.detail?.articles[0]).toMatchObject({ articleNumber: "3" })
  })

  it("treats an empty 200 detail response as source unavailable", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end("{}")
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.getDetail({ documentId: "missing", sourceType: "law" })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("SOURCE_UNAVAILABLE")
  })

  it("does not report metadata-only detail as usable body content", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          법령: { 기본정보: { 법령명_한글: "방위사업법", 법령ID: "123" } },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.getDetail({ documentId: "123", sourceType: "law" })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("SOURCE_UNAVAILABLE")
  })

  it("uses the administrative-rule ID parameter for rule details", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.searchParams.get("ID")).toBe("38163")
      expect(url.searchParams.get("MST")).toBeNull()
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          행정규칙: {
            행정규칙명: "방위사업관리규정",
            기본정보: { 법령명_한글: "방위사업관리규정", 법령ID: "38163" },
            조문: { 조문단위: [{ 조문번호: "1", 조문내용: "목적" }] },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.getDetail({
      documentId: "38163",
      sourceType: "administrative_rule",
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.results[0]?.title).toBe("방위사업관리규정")
    expect(result.detail?.basicInfo.lawId).toBe("38163")
    expect(result.detail?.articles[0]).toMatchObject({ articleNumber: "1", text: "목적" })
  })

  it("parses the official AdmRulService response shape", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.searchParams.get("target")).toBe("admrul")
      expect(url.searchParams.get("ID")).toBe("2100000284174")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          AdmRulService: {
            행정규칙기본정보: {
              행정규칙명: "방위사업관리규정",
              행정규칙ID: "2100000284174",
              발령일자: "20260101",
              시행일자: "20260102",
              소관부처명: "방위사업청",
            },
            조문내용: ["제1장 총칙", "제1조(목적) 이 지침은 업무 절차를 정함을 목적으로 한다."],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.getDetail({
      documentId: "2100000284174",
      sourceType: "administrative_rule",
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.detail?.basicInfo.title).toBe("방위사업관리규정")
    expect(result.detail?.basicInfo.lawId).toBe("2100000284174")
    expect(result.detail?.articles).toHaveLength(1)
    expect(result.detail?.articles[0]).toMatchObject({
      articleNumber: "1",
      title: "목적",
      text: "제1조(목적) 이 지침은 업무 절차를 정함을 목적으로 한다.",
    })
  })

  it("reuses a successful detail response from the TTL cache", async () => {
    // Given
    let requestCount = 0
    const api = await startFakeLawApi((_request, response) => {
      requestCount += 1
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          법령: {
            기본정보: { 법령명_한글: "방위사업법" },
            조문: { 조문단위: [{ 조문번호: "1", 조문내용: "목적" }] },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    await provider.getDetail({ documentId: "276787", sourceType: "law" })
    const result = await provider.getDetail({ documentId: "276787", sourceType: "law" })

    // Then
    expect(result.status).toBe("OK")
    expect(requestCount).toBe(1)
  })

  it("coalesces concurrent requests for the same detail document", async () => {
    // Given
    let requestCount = 0
    const api = await startFakeLawApi((_request, response) => {
      requestCount += 1
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          법령: {
            기본정보: { 법령명_한글: "방위사업법" },
            조문: { 조문단위: [{ 조문번호: "1", 조문내용: "목적" }] },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const results = await Promise.all([
      provider.getDetail({ documentId: "276787", sourceType: "law" }),
      provider.getDetail({ documentId: "276787", sourceType: "law" }),
    ])

    // Then
    expect(results.map((result) => result.status)).toEqual(["OK", "OK"])
    expect(requestCount).toBe(1)
  })
})
