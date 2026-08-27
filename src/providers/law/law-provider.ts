import { TtlCache } from "../../lib/cache/ttl-cache.js"
import { DapaError } from "../../lib/errors/dapa-error.js"
import type {
  DapaSearchResult,
  LegalHistoryResponse,
  SearchResponse,
  SourceType,
} from "../../types/results.js"
import { parseLawHistoryResponse } from "./history.js"
import { sanitizeUrlString } from "./law-api-sanitize.js"
import { parseLawDetailDocument } from "./law-detail.js"
import { LawHttpClient } from "./law-http.js"
import { parseLawSearchResponse } from "./law-response.js"
import { getTargetConfig, type LawTargetConfig } from "./target-config.js"

export type LegalSearchInput = {
  readonly query: string
  readonly types?: readonly SourceType[]
  readonly currentOnly?: boolean
  readonly forceRefresh?: boolean
  readonly asOfDate?: string
  readonly organization?: string
  readonly limit?: number
  readonly page?: number
}

export type LawProviderConfig = {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly retryLimit?: number
  readonly cacheTtlMs?: number
  readonly maxTextResponseBytes?: number
  readonly maxResourceResponseBytes?: number
}

export type LegalDetailInput = {
  readonly documentId: string
  readonly sourceType: SourceType
}

export type ProviderHealth = "healthy" | "not_configured" | "unavailable"

export class LawProvider {
  private readonly http: LawHttpClient
  private readonly cache: TtlCache<readonly DapaSearchResult[]>

  constructor(private readonly config: LawProviderConfig) {
    this.http = new LawHttpClient({
      baseUrl: config.baseUrl ?? "https://www.law.go.kr/DRF",
      timeoutMs: config.timeoutMs ?? 10_000,
      retryLimit: config.retryLimit ?? 2,
      maxTextResponseBytes: config.maxTextResponseBytes ?? 8 * 1024 * 1024,
      maxResourceResponseBytes: config.maxResourceResponseBytes ?? 25 * 1024 * 1024,
    })
    this.cache = new TtlCache(config.cacheTtlMs ?? 300_000)
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
        const target = getTargetConfig(sourceType)
        if (target === undefined) {
          throw new DapaError(
            "PROVIDER_NOT_CONFIGURED",
            `${sourceType} 검색 Provider는 v0.1.0에서 설정되지 않았습니다`,
          )
        }
        return this.searchTarget(input, target)
      }),
    )

    const results: DapaSearchResult[] = []
    const errors: { code: string; message: string }[] = []
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") results.push(...outcome.value)
      else errors.push(toErrorShape(outcome.reason))
    }

    const organization = input.organization
    const filtered =
      organization === undefined
        ? results
        : results.filter((result) => result.organization?.includes(organization))
    const limited = filtered.slice(0, input.limit ?? 10)
    if (errors.length > 0) {
      return {
        status: limited.length > 0 ? "PARTIAL_RESULT" : "SOURCE_UNAVAILABLE",
        results: limited,
        errors,
      }
    }
    return { status: limited.length > 0 ? "OK" : "NOT_FOUND", results: limited, errors: [] }
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
    try {
      const text = await this.http.get("lawSearch.do", {
        OC: this.config.apiKey ?? "",
        target: "lsHistory",
        type: "HTML",
        query: input.lawName,
        display: String(Math.min(input.limit ?? 20, 100)),
        sort: "efdes",
      })
      const parsed = parseLawHistoryResponse(text, input.lawName, input.limit ?? 20)
      return {
        status: parsed.versions.length > 0 ? "OK" : "NOT_FOUND",
        lawName: input.lawName,
        totalCount: parsed.totalCount,
        versions: parsed.versions,
        errors: [],
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        return {
          status: "SOURCE_UNAVAILABLE",
          lawName: input.lawName,
          totalCount: 0,
          versions: [],
          errors: [{ code: "INTERNAL_ERROR", message: "알 수 없는 내부 오류" }],
        }
      }
      return {
        status: "SOURCE_UNAVAILABLE",
        lawName: input.lawName,
        totalCount: 0,
        versions: [],
        errors: [toErrorShape(error)],
      }
    }
  }

  async listAllAdministrativeRules(): Promise<SearchResponse> {
    const pageSize = 100
    const collected: DapaSearchResult[] = []
    const target = getTargetConfig("administrative_rule")
    if (target === undefined)
      return unavailable("PROVIDER_NOT_CONFIGURED", "행정규칙 API가 설정되지 않았습니다")
    try {
      for (let page = 1; page <= 100; page += 1) {
        const text = await this.http.get("lawSearch.do", {
          OC: this.config.apiKey ?? "",
          target: target.target,
          type: "JSON",
          query: " ",
          display: String(pageSize),
          page: String(page),
        })
        const parsed = parseLawSearchResponse(text, target, new Date().toISOString())
        collected.push(...parsed.results)
        if (collected.length >= parsed.totalCount || parsed.results.length < pageSize) break
      }
    } catch (error) {
      if (!(error instanceof Error)) return unavailable("INTERNAL_ERROR", "알 수 없는 내부 오류")
      const shape = toErrorShape(error)
      return unavailable(shape.code, shape.message)
    }
    const unique = [...new Map(collected.map((result) => [result.documentId, result])).values()]
    return { status: unique.length === 0 ? "NOT_FOUND" : "OK", results: unique, errors: [] }
  }

  async getDetail(_input: LegalDetailInput): Promise<SearchResponse> {
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
    const idParameter = target.sourceType === "law" ? "MST" : "ID"
    try {
      const text = await this.http.get("lawService.do", {
        OC: this.config.apiKey ?? "",
        target: detailTarget,
        type: "JSON",
        [idParameter]: _input.documentId,
      })
      const parsed = parseLawDetailDocument(
        text,
        _input.documentId,
        target,
        new Date().toISOString(),
      )
      return { status: "OK", results: [parsed.result], detail: parsed.detail, errors: [] }
    } catch (error) {
      if (!(error instanceof Error)) {
        return unavailable("INTERNAL_ERROR", "알 수 없는 내부 오류")
      }
      const shape = toErrorShape(error)
      return unavailable(shape.code, shape.message)
    }
  }

  private async searchTarget(
    input: LegalSearchInput,
    target: LawTargetConfig,
  ): Promise<readonly DapaSearchResult[]> {
    const resolvedTarget =
      target.sourceType === "law" && (input.currentOnly === false || input.asOfDate !== undefined)
        ? { ...target, target: "eflaw" }
        : target
    const key = [
      resolvedTarget.target,
      input.query,
      input.limit ?? 10,
      input.currentOnly ?? true,
      input.organization ?? "",
      input.asOfDate ?? "",
      input.page ?? 1,
    ].join(":")
    const cached = input.forceRefresh === true ? undefined : this.cache.get(key)
    if (cached !== undefined) return cached

    const text = await this.http.get("lawSearch.do", {
      OC: this.config.apiKey ?? "",
      target: resolvedTarget.target,
      type: "JSON",
      query: input.query,
      display: String(Math.min(input.organization === undefined ? (input.limit ?? 10) : 100, 100)),
      page: String(input.page ?? 1),
      ...(input.asOfDate === undefined
        ? {}
        : {
            efYd: `${input.asOfDate.replaceAll("-", "")}~${input.asOfDate.replaceAll("-", "")}`,
          }),
    })
    const parsed = parseLawSearchResponse(text, resolvedTarget, new Date().toISOString())
    const results =
      input.currentOnly === false || input.asOfDate !== undefined
        ? parsed.results
        : parsed.results.filter(
            (result) => result.status !== "historical" && result.status !== "repealed",
          )
    if (parsed.totalCount > 0) this.cache.set(key, results)
    return results
  }
}

function unavailable(code: string, message: string): SearchResponse {
  return { status: "SOURCE_UNAVAILABLE", results: [], errors: [{ code, message }] }
}

function toErrorShape(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof DapaError) {
    return { code: error.code, message: sanitizeUrlString(error.message) }
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: sanitizeUrlString(error.message) }
  }
  return { code: "INTERNAL_ERROR", message: "알 수 없는 내부 오류" }
}
