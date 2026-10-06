import type { DapaSearchResult, SearchPageCoverage } from "../../types/results.js"
import { koreaToday } from "./law-api-temporal.js"
import { measureLawParse } from "./law-performance.js"
import { waitForDeadline } from "./law-provider-response.js"
import type { LegalSearchInput } from "./law-provider-types.js"
import { parseLawSearchResponse } from "./law-response.js"
import type { LawSearchCache } from "./law-search-cache.js"
import type { LawTemporalAccess } from "./law-temporal-access.js"
import type { LawTargetConfig } from "./target-config.js"

export type LawSearchPage = {
  readonly results: readonly DapaSearchResult[]
  readonly coverage: SearchPageCoverage
}
export type LawSearchAccess = {
  readonly cache: LawSearchCache<LawSearchPage>
  readonly temporal: LawTemporalAccess
  readonly apiKey: string
}

export async function searchLawTarget(
  input: LegalSearchInput,
  target: LawTargetConfig,
  access: LawSearchAccess,
): Promise<LawSearchPage> {
  const resolvedTarget = target.sourceType === "law" ? { ...target, target: "eflaw" } : target
  const display = Math.min(
    input.organization === undefined ? Math.max(input.limit ?? 10, 20) : 100,
    100,
  )
  const page = input.page ?? 1
  const key = JSON.stringify([
    resolvedTarget.target,
    input.query,
    display,
    input.currentOnly ?? true,
    input.organization ?? "",
    input.asOfDate ?? "",
    input.searchScope ?? "title",
    page,
    koreaToday(),
  ])
  const request = access.cache.getOrLoad(key, input.forceRefresh === true, async () => {
    const text = await access.temporal.search(
      {
        OC: access.apiKey,
        target: resolvedTarget.target,
        type: "JSON",
        query: input.query,
        display: String(display),
        page: String(page),
        ...(input.searchScope === "content" ? { search: "2" } : {}),
      },
      input,
    )
    const parsed = measureLawParse(
      () => parseLawSearchResponse(text, resolvedTarget, new Date().toISOString()),
      "list",
    )
    const hasMore = parsed.totalCounts.some((count) => page * display < count)
    return {
      results:
        input.currentOnly === false || input.asOfDate !== undefined
          ? parsed.results
          : parsed.results.filter(
              (result) => result.status !== "historical" && result.status !== "repealed",
            ),
      coverage: {
        sourceType: target.sourceType,
        query: input.query,
        page,
        pageSize: display,
        totalCount: parsed.totalCount,
        fetchedCount: parsed.fetchedCount,
        hasMore,
        ...(hasMore ? { nextPage: page + 1 } : {}),
      },
    }
  })
  return waitForDeadline(request, input.deadlineAt)
}
