import { DapaError } from "../../lib/errors/dapa-error.js"
import type {
  DapaSearchResult,
  LegalHistoryResponse,
  SearchPageCoverage,
  SearchResponse,
} from "../../types/results.js"
import { fetchAdministrativeCatalog } from "./law-administrative-catalog.js"
import { koreaToday } from "./law-api-temporal.js"
import { parseLawDetailDocument } from "./law-detail.js"
import { LawDetailCache } from "./law-detail-cache.js"
import { fetchLawHistory } from "./law-history-provider.js"
import { LawHttpClient } from "./law-http.js"
import { measureLawParse } from "./law-performance.js"
import { toErrorShape, unavailable, waitForDeadline } from "./law-provider-response.js"
import type {
  LawProviderConfig,
  LegalDetailInput,
  LegalSearchInput,
  ProviderHealth,
} from "./law-provider-types.js"
import { LawSearchCache } from "./law-search-cache.js"
import { rankSearchResults } from "./law-search-ranking.js"
import { type LawSearchPage, searchLawTarget } from "./law-search-target.js"
import { LawTemporalAccess } from "./law-temporal-access.js"
import { getTargetConfig } from "./target-config.js"

export type {
  LawProviderConfig,
  LegalDetailInput,
  LegalSearchInput,
  ProviderHealth,
} from "./law-provider-types.js"

export class LawProvider {
  private readonly http: LawHttpClient
  private readonly cache: LawSearchCache<LawSearchPage>
  private readonly detailCache: LawDetailCache
  private readonly currentDetailCache: LawDetailCache
  private readonly temporal: LawTemporalAccess

  constructor(private readonly config: LawProviderConfig) {
    this.http = new LawHttpClient({
      baseUrl: config.baseUrl ?? "https://www.law.go.kr/DRF",
      timeoutMs: config.timeoutMs ?? 15_000,
      retryLimit: config.retryLimit ?? 1,
      maxTextResponseBytes: config.maxTextResponseBytes ?? 8 * 1024 * 1024,
      maxResourceResponseBytes: config.maxResourceResponseBytes ?? 25 * 1024 * 1024,
      maxConcurrency: config.maxConcurrency ?? 8,
      maxQueue: config.maxQueue ?? 128,
      ...(config.referer === undefined ? {} : { referer: config.referer }),
      ...(config.userAgent === undefined ? {} : { userAgent: config.userAgent }),
    })
    this.cache = new LawSearchCache(
      Math.min(config.cacheTtlMs ?? 300_000, 300_000),
      (page) => page.results.length === 0,
    )
    this.detailCache = new LawDetailCache(config.detailCacheTtlMs ?? 21_600_000)
    this.currentDetailCache = new LawDetailCache(
      Math.min(config.cacheTtlMs ?? 300_000, config.detailCacheTtlMs ?? 21_600_000, 300_000),
    )
    this.temporal = new LawTemporalAccess(
      this.http,
      config.cacheTtlMs ?? 300_000,
      config.detailCacheTtlMs ?? 21_600_000,
    )
  }

  health(): ProviderHealth {
    return this.config.apiKey === undefined || this.config.apiKey.length === 0
      ? "not_configured"
      : "healthy"
  }

  async search(input: LegalSearchInput): Promise<SearchResponse> {
    if (this.health() === "not_configured") {
      return unavailable("AUTH_REQUIRED", "LAW_API_OC 환경변수가 설정되지 않았습니다")
    }
    const requestedTypes = input.types ?? ["law"]
    const settled = await Promise.allSettled(
      requestedTypes.map(async (sourceType) => {
        if (input.asOfDate !== undefined && sourceType !== "law")
          throw new DapaError(
            "INVALID_ARGUMENT",
            "asOfDate 기준일 조회는 법령 API에서만 지원됩니다",
          )
        const target = getTargetConfig(sourceType)
        if (target === undefined) {
          throw new DapaError(
            "PROVIDER_NOT_CONFIGURED",
            `${sourceType} 검색 Provider는 v0.1.0에서 설정되지 않았습니다`,
          )
        }
        return searchLawTarget(input, target, {
          cache: this.cache,
          temporal: this.temporal,
          apiKey: this.config.apiKey ?? "",
        })
      }),
    )

    const results: DapaSearchResult[] = []
    const pages: SearchPageCoverage[] = []
    const errors: { code: string; message: string }[] = []
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        results.push(...outcome.value.results)
        pages.push(outcome.value.coverage)
      } else errors.push(toErrorShape(outcome.reason))
    }

    const organization = input.organization
    const filtered =
      organization === undefined
        ? results
        : results.filter((result) => result.organization?.includes(organization))
    const limited = rankSearchResults(filtered, input.query).slice(0, input.limit ?? 10)
    const coverage = { pages, resultLimitReached: filtered.length > limited.length }
    if (errors.length > 0) {
      return {
        status: limited.length > 0 ? "PARTIAL_RESULT" : "SOURCE_UNAVAILABLE",
        results: limited,
        errors,
        coverage,
      }
    }
    return {
      status: limited.length > 0 ? "OK" : "NOT_FOUND",
      results: limited,
      errors: [],
      coverage,
    }
  }

  async getHistory(input: {
    readonly lawName: string
    readonly limit?: number
  }): Promise<LegalHistoryResponse> {
    if (this.health() === "not_configured") {
      return {
        status: "SOURCE_UNAVAILABLE",
        lawName: input.lawName,
        totalCount: 0,
        versions: [],
        errors: [{ code: "AUTH_REQUIRED", message: "LAW_API_OC 환경변수가 설정되지 않았습니다" }],
      }
    }
    return fetchLawHistory(this.http, this.config.apiKey ?? "", input)
  }

  async listAllAdministrativeRules(): Promise<SearchResponse> {
    return fetchAdministrativeCatalog(this.http, this.config.apiKey ?? "")
  }

  async getDetail(_input: LegalDetailInput): Promise<SearchResponse> {
    if (_input.asOfDate !== undefined && _input.sourceType !== "law")
      return unavailable("INVALID_ARGUMENT", "asOfDate 기준일 조회는 법령 API에서만 지원됩니다")
    if (this.health() === "not_configured") {
      return unavailable("AUTH_REQUIRED", "LAW_API_OC 환경변수가 설정되지 않았습니다")
    }
    const target = getTargetConfig(_input.sourceType)
    if (target === undefined) {
      return unavailable(
        "PROVIDER_NOT_CONFIGURED",
        `${_input.sourceType} 상세 Provider는 v0.1.0에서 설정되지 않았습니다`,
      )
    }
    const detailTarget = target.target
    const idParameter =
      target.sourceType === "law" || target.sourceType === "local_ordinance" ? "MST" : "ID"
    const cache = _input.currentOnly === false ? this.detailCache : this.currentDetailCache
    const request = cache.getOrLoad(
      JSON.stringify([
        detailTarget,
        _input.documentId,
        _input.currentOnly ?? true,
        _input.asOfDate ?? "",
        koreaToday(),
      ]),
      _input.forceRefresh === true,
      async () => {
        try {
          const resolved = await this.temporal.detail(
            {
              OC: this.config.apiKey ?? "",
              target: detailTarget,
              type: "JSON",
              [idParameter]: _input.documentId,
            },
            _input,
          )
          const parsed = measureLawParse(() =>
            parseLawDetailDocument(
              resolved.text,
              resolved.documentId,
              target,
              new Date().toISOString(),
            ),
          )
          const referenceDate = _input.asOfDate ?? koreaToday()
          const datedProof =
            (target.sourceType === "law" || target.sourceType === "administrative_rule") &&
            (_input.currentOnly !== false || _input.asOfDate !== undefined)
          const detail = datedProof
            ? {
                ...parsed.detail,
                articles: parsed.detail.articles.filter(
                  (article) =>
                    article.effectiveDate === undefined || article.effectiveDate <= referenceDate,
                ),
              }
            : parsed.detail
          return {
            status: "OK",
            results: [{ ...parsed.result, status: resolved.status }],
            detail,
            errors: [],
          }
        } catch (error) {
          if (!(error instanceof Error)) {
            return unavailable("INTERNAL_ERROR", "알 수 없는 내부 오류")
          }
          const shape = toErrorShape(error)
          return unavailable(shape.code, shape.message)
        }
      },
    )
    try {
      return await waitForDeadline(request, _input.deadlineAt)
    } catch (error) {
      if (!(error instanceof Error)) return unavailable("INTERNAL_ERROR", "알 수 없는 내부 오류")
      const shape = toErrorShape(error)
      return unavailable(shape.code, shape.message)
    }
  }
}
