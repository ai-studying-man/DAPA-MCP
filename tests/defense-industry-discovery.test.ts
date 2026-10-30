import { afterEach, expect, it } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { searchLegalContentParallel } from "../src/providers/law/parallel-content-search.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

let api: FakeLawApi | undefined
afterEach(async () => api?.close())

it.each([false, true])(
  "finds an older generic civil dispute without duplicate cases; title alias=%s",
  async (titleAlias) => {
    const ids: string[] = []
    api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        const body = url.searchParams.get("search") === "2"
        const industry = url.searchParams.get("query")?.includes("방위산업")
        const olderCase = (id: string) => ({
          판례일련번호: id,
          사건명: "채무부존재확인",
          사건번호: "1990다11111",
          법원명: "대법원",
          선고일자: "19900101",
        })
        const documents = !body
          ? titleAlias
            ? [olderCase("old")]
            : []
          : industry
            ? (titleAlias ? ["duplicate"] : ["old", "duplicate"]).map(olderCase)
            : Array.from({ length: 6 }, (_, i) => ({
                판례일련번호: `recent${i}`,
                사건명: "정산금청구",
                사건번호: `2020다1111${i}`,
                법원명: "대법원",
                선고일자: "20200101",
              }))
        response.end(
          JSON.stringify({ PrecSearch: { totalCnt: String(documents.length), prec: documents } }),
        )
      } else {
        const id = url.searchParams.get("ID") ?? ""
        ids.push(id)
        response.end(
          JSON.stringify({
            PrecService: {
              사건명: id === "old" ? "채무부존재확인" : "정산금청구",
              판결요지:
                id === "old"
                  ? "방위산업 업체 선박 계약의 지체상금 감액 판단"
                  : "방위사업청 계약의 환율 정산. 지체상금 조항은 인용에 불과하다.",
            },
          }),
        )
      }
    })
    const result = await searchLegalContentParallel(
      new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }),
      { query: "방산물자 계약 지체상금 판례를 알려줘", types: ["precedent"] },
    )
    expect(result.results.some((hit) => hit.document.documentId === "old")).toBe(true)
    expect(ids).not.toContain("duplicate")
    expect(result.answerEvidence.decision).toBe("partial")
  },
)
