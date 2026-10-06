import type { DapaSearchResult, SearchResponse } from "../../types/results.js"
import type { LawHttpClient } from "./law-http.js"
import { measureLawParse } from "./law-performance.js"
import { toErrorShape, unavailable } from "./law-provider-response.js"
import { parseLawSearchResponse } from "./law-response.js"
import { getTargetConfig } from "./target-config.js"

export async function fetchAdministrativeCatalog(
  http: LawHttpClient,
  apiKey: string,
): Promise<SearchResponse> {
  const pageSize = 100
  const collected: DapaSearchResult[] = []
  const target = getTargetConfig("administrative_rule")
  if (target === undefined)
    return unavailable("PROVIDER_NOT_CONFIGURED", "행정규칙 API가 설정되지 않았습니다")
  try {
    for (const nw of ["1", "2"]) {
      let categoryCount = 0
      for (let page = 1; page <= 100; page += 1) {
        const text = await http.get("lawSearch.do", {
          OC: apiKey,
          target: target.target,
          type: "JSON",
          query: " ",
          display: String(pageSize),
          page: String(page),
          org: "1690000",
          nw,
        })
        const parsed = measureLawParse(
          () => parseLawSearchResponse(text, target, new Date().toISOString()),
          "list",
        )
        collected.push(...parsed.results)
        categoryCount += parsed.results.length
        if (categoryCount >= parsed.totalCount || parsed.results.length < pageSize) break
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) return unavailable("INTERNAL_ERROR", "알 수 없는 내부 오류")
    const shape = toErrorShape(error)
    return unavailable(shape.code, shape.message)
  }
  const unique = [...new Map(collected.map((result) => [result.documentId, result])).values()]
  return { status: unique.length === 0 ? "NOT_FOUND" : "OK", results: unique, errors: [] }
}
