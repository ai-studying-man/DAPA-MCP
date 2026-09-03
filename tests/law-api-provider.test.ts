import { afterEach, describe, expect, it } from "vitest"
import { LAW_API_CATEGORY_IDS, listLawApiCategories } from "../src/providers/law/law-api-catalog.js"
import { LawApiProvider } from "../src/providers/law/law-api-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("law API capability catalog", () => {
  it("lists every requested official API category", () => {
    // Given
    const expected = [
      "pre_consultation_opinion",
      "central_ministry_interpretation",
      "legal_knowledge_base",
      "customized",
      "legal_term",
      "attachment_form",
      "treaty",
      "constitutional_case",
      "interpretation",
      "administrative_appeal",
      "law",
      "administrative_rule",
      "local_ordinance",
      "precedent",
    ]

    // When
    const categories = listLawApiCategories()

    // Then
    expect(LAW_API_CATEGORY_IDS).toEqual(expected)
    expect(categories.map((category) => category.id)).toEqual(expected)
    expect(categories.every((category) => category.apis.length > 0)).toBe(true)
    expect(
      categories.every((category) =>
        category.apis.some(
          (api) => api.operation !== "list" || api.bodyResolution === "download_link",
        ),
      ),
    ).toBe(true)
  })
})

describe("LawApiProvider", () => {
  it("applies a shared temporal scope to law and administrative-rule APIs", async () => {
    // Given
    const requests: URL[] = []
    const api = await startFakeLawApi((request, response) => {
      requests.push(new URL(request.url ?? "/", "http://localhost"))
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: { totalCnt: "1", law: { 법령일련번호: "1", 법령명한글: "방위사업법" } },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const historical = await provider.query({
      apiId: "law.list",
      query: "방위사업법",
      currentOnly: false,
      asOfDate: "2020-01-02",
    })
    const rules = await provider.query({
      apiId: "administrative_rule.list",
      query: "방위사업",
      currentOnly: false,
    })

    // Then
    expect(requests[0]?.searchParams.get("target")).toBe("eflaw")
    expect(requests[0]?.searchParams.get("efYd")).toBe("20200102~20200102")
    expect(historical.temporalScope).toBe("as_of")
    expect(requests[1]?.searchParams.get("nw")).toBe("2")
    expect(rules.temporalScope).toBe("all")
  })

  it("caches successful DAPA interpretation API responses until forceRefresh", async () => {
    // Given
    let requestCount = 0
    const api = await startFakeLawApi((_request, response) => {
      requestCount += 1
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          CgmExpc: { totalCnt: "1", cgmExpc: { 안건명: `응답 ${requestCount}` } },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
      cacheTtlMs: 60_000,
    })

    // When
    const first = await provider.query({
      apiId: "central_ministry_interpretation.dapa_list",
      query: "방위사업",
    })
    const cached = await provider.query({
      apiId: "central_ministry_interpretation.dapa_list",
      query: "방위사업",
    })
    const refreshed = await provider.query({
      apiId: "central_ministry_interpretation.dapa_list",
      query: "방위사업",
      forceRefresh: true,
    })

    // Then
    expect(requestCount).toBe(2)
    expect(first.data).toMatchObject({ CgmExpc: { cgmExpc: { 안건명: "응답 1" } } })
    expect(cached.data).toEqual(first.data)
    expect(refreshed.data).toMatchObject({ CgmExpc: { cgmExpc: { 안건명: "응답 2" } } })
  })

  it("routes a DAPA first-interpretation list request to dapaCgmExpc", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.pathname).toBe("/lawSearch.do")
      expect(url.searchParams.get("target")).toBe("dapaCgmExpc")
      expect(url.searchParams.get("query")).toBe("방위사업")
      expect(url.searchParams.get("display")).toBe("5")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          CgmExpc: {
            totalCnt: "1",
            cgmExpc: {
              id: "1",
              법령해석일련번호: "409840",
              안건명: "7일 이내가 공휴일을 포함하는 것인지 여부",
            },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
    })

    // When
    const result = await provider.query({
      apiId: "central_ministry_interpretation.dapa_list",
      query: "방위사업",
      limit: 5,
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.apiId).toBe("central_ministry_interpretation.dapa_list")
    expect(result.data).toMatchObject({ CgmExpc: { totalCnt: "1" } })
    expect(result.bodyReferences).toEqual([
      {
        bodyApiId: "central_ministry_interpretation.dapa_detail",
        inputName: "documentId",
        inputValue: "409840",
        kind: "api_input",
        sourceField: "법령해석일련번호",
      },
    ])
  })

  it("redacts OC from URLs embedded in raw API response data", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "1",
            law: {
              법령상세링크: "/DRF/lawService.do?%4F%43=secret-value&target=eflaw&MST=276787",
            },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.query({ apiId: "law.list", query: "방위사업법" })

    // Then
    expect(JSON.stringify(result)).not.toContain("secret-value")
    expect(JSON.stringify(result)).not.toContain("%4F%43")
    expect(JSON.stringify(result)).toContain("target=eflaw")
  })

  it("routes a DAPA first-interpretation detail request with its official ID", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.pathname).toBe("/lawService.do")
      expect(url.searchParams.get("target")).toBe("dapaCgmExpc")
      expect(url.searchParams.get("ID")).toBe("409840")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          CgmExpcService: {
            법령해석일련번호: "409840",
            안건명: "7일 이내가 공휴일을 포함하는 것인지 여부",
            회답: "토요일 및 공휴일을 포함하여 계산합니다.",
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
    })

    // When
    const result = await provider.query({
      apiId: "central_ministry_interpretation.dapa_detail",
      documentId: "409840",
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.data).toMatchObject({
      CgmExpcService: { 법령해석일련번호: "409840" },
    })
  })

  it("routes a promulgated-law list identifier to the matching law detail target", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.pathname).toBe("/lawService.do")
      expect(url.searchParams.get("target")).toBe("law")
      expect(url.searchParams.get("MST")).toBe("281867")
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ 법령: { 법령일련번호: "281867", 법령명_한글: "방위사업법" } }))
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.query({ apiId: "law.detail", documentId: "281867" })

    // Then
    expect(result.status).toBe("OK")
  })

  it("rejects a detail request that omits its required document ID", async () => {
    // Given
    const provider = new LawApiProvider({ apiKey: "test" })

    // When
    const result = await provider.query({
      apiId: "pre_consultation_opinion.detail",
    })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("INVALID_ARGUMENT")
  })

  it("treats an HTTP 200 authentication failure envelope as an authentication error", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          result: "사용자 정보 검증에 실패하였습니다.",
          msg: "OPEN API 호출 시 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.",
        }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({
      apiKey: "invalid",
      baseUrl: api.baseUrl,
      retryLimit: 0,
    })

    // When
    const result = await provider.query({
      apiId: "central_ministry_interpretation.dapa_list",
    })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("AUTH_REQUIRED")
    expect(result.errors[0]?.message).toContain("사용자 정보 검증에 실패")
  })

  it("rejects an upstream JSON response larger than the configured byte limit", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({ LawSearch: { totalCnt: "1", law: { 본문: "가".repeat(500) } } }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
      maxTextResponseBytes: 128,
    })

    // When
    const result = await provider.query({ apiId: "law.list", query: "방위사업법" })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.message).toContain("응답 크기 제한")
  })

  it("treats a nested non-success result code as an upstream error", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          CgmExpc: {
            resultCode: "99",
            resultMsg: "요청 변수 값이 올바르지 않습니다. https://www.law.go.kr/?OC=secret-value",
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.query({
      apiId: "central_ministry_interpretation.dapa_list",
    })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.message).toContain("resultCode=99")
    expect(result.errors[0]?.message).not.toContain("secret-value")
  })

  it("does not treat a metadata-only success detail envelope as NOT_FOUND", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ Law: { resultCode: "00", resultMsg: "success" } }))
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.query({ apiId: "law.detail", documentId: "123" })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.message).toContain("본문")
  })

  it("maps an official no-result message to NOT_FOUND", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({ Law: "일치하는 법령용어가 없습니다. 검색조건을 확인하여 주십시오." }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.query({ apiId: "legal_term.detail", query: "없는 용어" })

    // Then
    expect(result.status).toBe("NOT_FOUND")
    expect(result.errors).toEqual([])
  })

  it("does not treat a metadata-only success list envelope as NOT_FOUND", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ LawSearch: { resultCode: "00", resultMsg: "success" } }))
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.query({ apiId: "law.list", query: "방위사업법" })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.message).toContain("결과")
  })

  it("returns official attachment download links from the law annex list", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.searchParams.get("target")).toBe("licbyl")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          licBylSearch: {
            totalCnt: "1",
            licbyl: {
              별표명: "계약서 서식",
              별표서식파일링크: "/LSW/flDownload.do?flSeq=1",
            },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawApiProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
    })

    // When
    const result = await provider.query({ apiId: "attachment_form.law_list" })

    // Then
    expect(result.status).toBe("OK")
    expect(result.data).toMatchObject({
      licBylSearch: { licbyl: { 별표서식파일링크: "/LSW/flDownload.do?flSeq=1" } },
    })
  })

  it("reports a zero-count list envelope as NOT_FOUND", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ LawSearch: { totalCnt: "0" } }))
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.query({ apiId: "law.list", query: "없는 법령" })

    // Then
    expect(result.status).toBe("NOT_FOUND")
  })

  it("requests customized article content with its vcode", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.searchParams.get("target")).toBe("couseLs")
      expect(url.searchParams.get("vcode")).toBe("L0000000003384")
      expect(url.searchParams.get("lj")).toBe("jo")
      expect(url.searchParams.get("display")).toBe("5")
      expect(url.searchParams.get("page")).toBe("2")
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ 맞춤형분류: { 법령: { 조문: { 조문단위: [] } } } }))
    })
    openApis.push(api)
    const provider = new LawApiProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
    })

    // When
    const result = await provider.query({
      apiId: "customized.law_articles",
      customCode: "L0000000003384",
      limit: 5,
      page: 2,
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.operation).toBe("content")
  })
})
