import iconv from "iconv-lite"
import { afterEach, describe, expect, it } from "vitest"
import { OfficialCourtProvider } from "../src/providers/court/provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

function judgmentPdf(text: string): Buffer {
  const hex = [...text].map((char) => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")
  const stream = `BT /F1 12 Tf 30 200 Td <${hex}> Tj ET`
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end"
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /DW 500 /CIDToGIDMap /Identity >>",
    "<< /Type /FontDescriptor /FontName /Test /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 >>",
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  ]
  let data = "%PDF-1.7\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(data))
    data += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(data)
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  data += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  data += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(data)
}

async function courtApi(
  options: {
    readonly mismatch?: boolean
    readonly blocked?: boolean
    readonly redirect?: boolean
    readonly oversized?: boolean
  } = {},
) {
  const requests: string[] = []
  const api = await startFakeLawApi((request, response) => {
    requests.push(request.url ?? "")
    const url = new URL(request.url ?? "/", "http://localhost")
    if (url.pathname === "/AttachDownload") {
      if (options.redirect) {
        response.writeHead(302, { location: "https://example.com/untrusted.pdf" })
        response.end()
        return
      }
      if (options.oversized) {
        response.setHeader("content-length", "9000000")
        response.end("x")
        return
      }
      response.setHeader("content-type", options.blocked ? "text/html" : "application/octet-stream")
      response.end(
        options.blocked
          ? "<html>Access denied</html>"
          : judgmentPdf(
              `사 건 ${options.mismatch ? "2021다99999" : "2020다12345"} 물품대금 판 결 선 고 2026. 4. 30. 주 문 나머지 상고를 기각한다. 이 유 지체상금을 감액하였다.`,
            ),
      )
      return
    }
    const html = url.pathname.endsWith("NewsListAction.work")
      ? '<div id="content"><a href="/portal/news/NewsViewAction.work?gubun=2&amp;seqnum=17">지연배상금 판단</a></div>'
      : '<script>function download(file,name){form.path.value="001";}</script><div id="content"><table class="tableVer"><tr><th>제목</th><td>지연배상금 판단</td></tr><tr><th>작성일</th><td>2026-06-09</td></tr><tr><td class="attTxt"><a href="javascript:download(\'777_123.pdf\',\'2020다12345_판결문.pdf\')">판결문</a></td></tr></table></div>'
    response.setHeader("content-type", "text/html; charset=euc-kr")
    response.end(iconv.encode(html, "euc-kr"))
  })
  apis.push(api)
  return {
    provider: new OfficialCourtProvider({ baseUrl: api.baseUrl, fileBaseUrl: api.baseUrl }),
    requests,
  }
}

describe("official court original provider", () => {
  it("shares one original download when different employee questions discover the same case", async () => {
    // Given
    const { provider, requests } = await courtApi()
    // When
    const responses = await Promise.all([
      provider.search({ query: "방산 지체상금 감액 사례" }),
      provider.search({ query: "납품 지체상금 판례" }),
    ])
    // Then
    expect(responses.every((response) => response.status === "OK")).toBe(true)
    expect(requests.filter((url) => url.startsWith("/AttachDownload"))).toHaveLength(1)
  })
  it("returns a dynamically discovered actual PDF original with provenance", async () => {
    // Given
    const { provider, requests } = await courtApi()
    // When
    const result = await provider.search({
      query: "방산 지체상금 사례",
      deadlineAt: Date.now() + 10_000,
    })
    // Then
    expect(result.status).toBe("OK")
    expect(result.results[0]).toMatchObject({
      summary: "2020다12345",
      sourceType: "precedent",
      verified: true,
      status: "unknown",
    })
    expect(result.results[0]?.content).toContain("지체상금을 감액하였다")
    expect(requests.some((url) => url.includes("%C1%F6%BF%AC"))).toBe(true)
    expect(requests.filter((url) => url.startsWith("/AttachDownload"))).toHaveLength(1)
  })

  it.each([{ mismatch: true }, { blocked: true }])(
    "never certifies a mismatched or HTML-blocked PDF: %j",
    async (options) => {
      // Given
      const { provider } = await courtApi(options)
      // When
      const result = await provider.search({ query: "지체상금" })
      // Then
      expect(result.status).toBe("SOURCE_UNAVAILABLE")
      expect(result.results).toHaveLength(0)
      expect(result.errors.length).toBeGreaterThan(0)
    },
  )

  it("rejects arbitrary detail identifiers without making requests", async () => {
    // Given
    const { provider, requests } = await courtApi()
    // When
    const result = await provider.getDetail({ documentId: "https://example.com/private.pdf" })
    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(requests).toHaveLength(0)
  })

  it.each([{ redirect: true }, { oversized: true }])(
    "rejects unsafe attachment transport: %j",
    async (options) => {
      // Given
      const { provider, requests } = await courtApi(options)
      // When
      const result = await provider.search({ query: "지체상금" })
      // Then
      expect(result.status).toBe("SOURCE_UNAVAILABLE")
      expect(result.results).toHaveLength(0)
      expect(requests.filter((url) => url.startsWith("/AttachDownload"))).toHaveLength(1)
    },
  )

  it("shares one PDF download across concurrent identical searches", async () => {
    // Given
    const { provider, requests } = await courtApi()
    // When
    const responses = await Promise.all([
      provider.search({ query: "지체상금" }),
      provider.search({ query: "지체상금" }),
    ])
    // Then
    expect(responses.map((response) => response.status)).toEqual(["OK", "OK"])
    expect(requests.filter((url) => url.startsWith("/AttachDownload"))).toHaveLength(1)
  })

  it("does not start network work after an expired caller deadline", async () => {
    // Given
    const { provider, requests } = await courtApi()
    // When
    const response = await provider.search({ query: "지체상금", deadlineAt: Date.now() - 1 })
    // Then
    expect(response.errors[0]?.code).toBe("TIMEOUT")
    expect(requests).toHaveLength(0)
  })
})
