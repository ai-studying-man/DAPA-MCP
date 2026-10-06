import { TtlCache } from "../../lib/cache/ttl-cache.js"
import { DapaError } from "../../lib/errors/dapa-error.js"
import type { ListPageCoverage, ResponseStatus } from "../../types/results.js"
import {
  type LawApiBodyInput,
  LawApiBodyResolver,
  type LawApiBodyResponse,
} from "./law-api-body.js"
import { getLawApiConfig, type LawApiConfig, type LawApiId } from "./law-api-catalog.js"
import { extractLawApiBodyReferences, type LawApiBodyReference } from "./law-api-references.js"
import { apiQueryCacheKey, buildSearchParams, inputValue } from "./law-api-request.js"
import { parseLawApiResponse } from "./law-api-response.js"
import { sanitizeUrlString } from "./law-api-sanitize.js"
import { temporalRequest, temporalScopeFor } from "./law-api-temporal.js"
import { LawHttpClient } from "./law-http.js"
import { extractListCoverage } from "./law-list-coverage.js"
import type { LawProviderConfig, ProviderHealth } from "./law-provider.js"
import { LawTemporalAccess } from "./law-temporal-access.js"

export type LawApiQueryInput = {
  readonly apiId: LawApiId
  readonly query?: string
  readonly documentId?: string
  readonly customCode?: string
  readonly articleNumber?: string
  readonly limit?: number
  readonly page?: number
  readonly currentOnly?: boolean
  readonly asOfDate?: string
  readonly forceRefresh?: boolean
}

export const TEMPORAL_SCOPES = ["current", "all", "as_of", "not_applicable"] as const
export type TemporalScope = (typeof TEMPORAL_SCOPES)[number]

export type LawApiQueryResponse = {
  readonly status: ResponseStatus
  readonly apiId: LawApiId
  readonly categoryId: LawApiConfig["categoryId"]
  readonly operation: LawApiConfig["operation"]
  readonly source: "국가법령정보 공동활용 Open API"
  readonly sourceUrl: string
  readonly retrievedAt: string
  readonly temporalScope: TemporalScope
  readonly data: Readonly<Record<string, unknown>>
  readonly bodyReferences: readonly LawApiBodyReference[]
  readonly errors: readonly { readonly code: string; readonly message: string }[]
  readonly coverage?: ListPageCoverage
}

export class LawApiProvider {
  private readonly http: LawHttpClient
  private readonly bodyResolver: LawApiBodyResolver
  private readonly cache: TtlCache<LawApiQueryResponse>
  private readonly temporal: LawTemporalAccess

  constructor(private readonly config: LawProviderConfig) {
    const baseUrl = config.baseUrl ?? "https://www.law.go.kr/DRF"
    this.http = new LawHttpClient({
      baseUrl,
      timeoutMs: config.timeoutMs ?? 55_000,
      retryLimit: config.retryLimit ?? 2,
      maxTextResponseBytes: config.maxTextResponseBytes ?? 8 * 1024 * 1024,
      maxResourceResponseBytes: config.maxResourceResponseBytes ?? 25 * 1024 * 1024,
      maxConcurrency: config.maxConcurrency ?? 8,
      maxQueue: config.maxQueue ?? 128,
      ...(config.referer === undefined ? {} : { referer: config.referer }),
      ...(config.userAgent === undefined ? {} : { userAgent: config.userAgent }),
    })
    this.cache = new TtlCache(Math.min(config.cacheTtlMs ?? 300_000, 300_000))
    this.temporal = new LawTemporalAccess(
      this.http,
      config.cacheTtlMs ?? 300_000,
      config.detailCacheTtlMs ?? 21_600_000,
    )
    const siteBaseUrl = new URL(`${new URL(baseUrl).origin}/`)
    this.bodyResolver = new LawApiBodyResolver(this.http, siteBaseUrl, (input) => this.query(input))
  }

  health(): ProviderHealth {
    return this.config.apiKey === undefined || this.config.apiKey.length === 0
      ? "not_configured"
      : "healthy"
  }

  async query(input: LawApiQueryInput): Promise<LawApiQueryResponse> {
    const api = getLawApiConfig(input.apiId)
    const retrievedAt = new Date().toISOString()
    if (this.health() === "not_configured") {
      return failure(
        api,
        retrievedAt,
        {
          code: "AUTH_REQUIRED",
          message: "LAW_API_OC 환경변수가 설정되지 않았습니다",
        },
        temporalScopeFor(api, input),
      )
    }
    if (input.asOfDate !== undefined && api.categoryId !== "law") {
      return failure(
        api,
        retrievedAt,
        {
          code: "INVALID_ARGUMENT",
          message: "asOfDate 기준일 조회는 법령 API에서만 지원됩니다",
        },
        "not_applicable",
      )
    }
    const missing = api.requiredInputs.find((name) => inputValue(input, name) === undefined)
    if (missing !== undefined) {
      return failure(
        api,
        retrievedAt,
        {
          code: "INVALID_ARGUMENT",
          message: `${missing} 입력이 필요합니다`,
        },
        temporalScopeFor(api, input),
      )
    }
    const temporal = temporalRequest(api, input)
    const key = apiQueryCacheKey(input)
    if (input.forceRefresh !== true) {
      const cached = this.cache.get(key)
      if (cached !== undefined) return cached
    }

    try {
      const params = buildSearchParams(api, input, this.config.apiKey ?? "")
      const isStatute = api.categoryId === "law" || api.categoryId === "administrative_rule"
      const text = isStatute
        ? api.operation === "list"
          ? await this.temporal.search(params, input)
          : (await this.temporal.detail(params, input)).text
        : await this.http.get(api.endpoint, params)
      const { data, status } = parseLawApiResponse(text, api)
      const coverage =
        api.paginated === true
          ? extractListCoverage(data, input.page ?? 1, Math.min(input.limit ?? 20, 100))
          : undefined
      const response: LawApiQueryResponse = {
        status,
        apiId: api.id,
        categoryId: api.categoryId,
        operation: api.operation,
        source: "국가법령정보 공동활용 Open API",
        sourceUrl: sourceUrl(api, temporal.target),
        retrievedAt,
        temporalScope: temporal.scope,
        data,
        bodyReferences: extractLawApiBodyReferences(api, data),
        errors: [],
        ...(coverage === undefined ? {} : { coverage }),
      }
      if (response.status === "OK") this.cache.set(key, response)
      return response
    } catch (error) {
      if (!(error instanceof Error)) {
        return failure(api, retrievedAt, {
          code: "INTERNAL_ERROR",
          message: "알 수 없는 내부 오류",
        })
      }
      const shaped = toErrorShape(error)
      return failure(api, retrievedAt, shaped)
    }
  }

  async resolveBody(input: LawApiBodyInput): Promise<LawApiBodyResponse> {
    return this.bodyResolver.resolve(input)
  }
}

function failure(
  api: LawApiConfig,
  retrievedAt: string,
  error: { readonly code: string; readonly message: string },
  temporalScope: TemporalScope = "not_applicable",
): LawApiQueryResponse {
  return {
    status: "SOURCE_UNAVAILABLE",
    apiId: api.id,
    categoryId: api.categoryId,
    operation: api.operation,
    source: "국가법령정보 공동활용 Open API",
    sourceUrl: sourceUrl(api, api.target),
    retrievedAt,
    temporalScope,
    data: {},
    bodyReferences: [],
    errors: [error],
  }
}

function sourceUrl(api: LawApiConfig, target: string): string {
  return `https://www.law.go.kr/DRF/${api.endpoint}?target=${target}`
}

function toErrorShape(error: Error): { readonly code: string; readonly message: string } {
  if (error instanceof DapaError) {
    return { code: error.code, message: sanitizeUrlString(error.message) }
  }
  return { code: "INTERNAL_ERROR", message: sanitizeUrlString(error.message) }
}
