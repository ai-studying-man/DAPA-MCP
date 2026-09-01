import { markdownToHwpx } from "kordoc"
import { afterEach, describe, expect, it } from "vitest"
import {
  getLawApiBodyApiId,
  getLawApiBodyReferenceFields,
  getLawApiConfig,
  LAW_API_IDS,
} from "../src/providers/law/law-api-catalog.js"
import { LawApiProvider } from "../src/providers/law/law-api-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("law API body resolution", () => {
  it("provides an executable body route for all 40 APIs", () => {
    // Given
    const expectedApiCount = 40

    // When
    const routes = LAW_API_IDS.map((apiId) => ({
      resolution: getLawApiConfig(apiId).bodyResolution,
      bodyApiId: getLawApiBodyApiId(apiId),
      referenceFields: getLawApiBodyReferenceFields(apiId),
    }))

    // Then
    expect(routes).toHaveLength(expectedApiCount)
    expect(
      routes.every(
        (route) => route.resolution === "download_link" || route.bodyApiId !== undefined,
      ),
    ).toBe(true)
    expect(
      routes.every(
        (route) => route.resolution === "response_body" || route.referenceFields.length > 0,
      ),
    ).toBe(true)
  })

  it("resolves a DAPA list capability to its official detail API", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.pathname).toBe("/lawService.do")
      expect(url.searchParams.get("target")).toBe("dapaCgmExpc")
      expect(url.searchParams.get("ID")).toBe("409840")
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ CgmExpcService: { 회답: "본문" } }))
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.resolveBody({
      apiId: "central_ministry_interpretation.dapa_list",
      documentId: "409840",
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.requestedApiId).toBe("central_ministry_interpretation.dapa_list")
    expect(result.resolvedApiId).toBe("central_ministry_interpretation.dapa_detail")
    expect(result.data).toMatchObject({ CgmExpcService: { 회답: "본문" } })
  })

  it("retrieves attachment body text from an official list download link", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.pathname).toBe("/LSW/flDownload.do")
      expect(url.searchParams.get("flSeq")).toBe("1")
      expect(url.searchParams.get("oc")).toBeNull()
      expect(url.searchParams.get("Oc")).toBeNull()
      response.setHeader("content-type", "text/plain; charset=utf-8")
      response.end("방위사업청 계약서 별표 본문")
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.resolveBody({
      apiId: "attachment_form.law_list",
      attachmentUrl: "/LSW/flDownload.do?flSeq=1&oc=secret-value&%4Fc=another-secret",
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.resolution).toBe("download_link")
    expect(result.data).toMatchObject({
      attachment: { fileType: "text", content: "방위사업청 계약서 별표 본문" },
    })
    expect(JSON.stringify(result)).not.toContain("OC=secret-value")
  })

  it("rejects an HTML permission page returned from an attachment link", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8")
      response.end("<html><body>접근 권한이 없습니다</body></html>")
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.resolveBody({
      apiId: "attachment_form.law_list",
      attachmentUrl: "/flDownload.do?flSeq=5",
    })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.data).toEqual({})
  })

  it("preserves legitimate plain-text content containing the word error", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "text/plain; charset=utf-8")
      response.end("사용자 오류 시 관리자에게 알려주세요")
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.resolveBody({
      apiId: "attachment_form.law_list",
      attachmentUrl: "/flDownload.do?flSeq=7",
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.data).toMatchObject({
      attachment: { content: "사용자 오류 시 관리자에게 알려주세요" },
    })
  })

  it("rejects a successfully parsed attachment with empty body text", async () => {
    // Given
    const hwpx = await markdownToHwpx("")
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/octet-stream")
      response.end(Buffer.from(hwpx))
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.resolveBody({
      apiId: "attachment_form.law_list",
      attachmentUrl: "/flDownload.do?flSeq=6",
    })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.data).toEqual({})
  })

  it("rejects redirects from an official attachment path", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      if (url.pathname === "/LSW/flDownload.do") {
        response.statusCode = 302
        response.setHeader("location", "/sink")
        response.end()
        return
      }
      response.setHeader("content-type", "text/plain; charset=utf-8")
      response.end("redirect sink")
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.resolveBody({
      apiId: "attachment_form.law_list",
      attachmentUrl: "/LSW/flDownload.do?flSeq=4",
    })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.data).toEqual({})
  })

  it("downloads and parses an HWPX attachment into body text", async () => {
    // Given
    const hwpx = await markdownToHwpx("# 방위사업청 별표\n\n계약보증금 기준 본문")
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/octet-stream")
      response.end(Buffer.from(hwpx))
    })
    openApis.push(api)
    const provider = new LawApiProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.resolveBody({
      apiId: "attachment_form.law_list",
      attachmentUrl: "/flDownload.do?flSeq=2",
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.data).toMatchObject({ attachment: { fileType: "hwpx" } })
    expect(JSON.stringify(result.data)).toContain("계약보증금 기준 본문")
  })

  it("rejects an attachment larger than the configured byte limit", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "text/plain; charset=utf-8")
      response.end("방".repeat(500))
    })
    openApis.push(api)
    const provider = new LawApiProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
      maxResourceResponseBytes: 128,
    })

    // When
    const result = await provider.resolveBody({
      apiId: "attachment_form.law_list",
      attachmentUrl: "/flDownload.do?flSeq=3",
    })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.message).toContain("응답 크기 제한")
  })
})
