import { TtlCache } from "../../lib/cache/ttl-cache.js"
import { DapaError } from "../../lib/errors/dapa-error.js"
import type { ResponseStatus } from "../../types/results.js"
import {
  type LawApiBodyInput,
  LawApiBodyResolver,
  type LawApiBodyResponse,
} from "./law-api-body.js"
import {
  getLawApiConfig,
  type LawApiConfig,
  type LawApiId,
  type LawApiInputName,
} from "./law-api-catalog.js"
import { extractLawApiBodyReferences, type LawApiBodyReference } from "./law-api-references.js"
import { parseLawApiResponse } from "./law-api-response.js"
import { sanitizeUrlString } from "./law-api-sanitize.js"
import { LawHttpClient } from "./law-http.js"
import type { LawProviderConfig, ProviderHealth } from "./law-provider.js"

export type LawApiQueryInput = {
  readonly apiId: LawApiId
  readonly query?: string
  readonly documentId?: string
  readonly customCode?: string
  readonly articleNumber?: string
  readonly limit?: number
  readonly page?: number
  readonly forceRefresh?: boolean
}

export type LawApiQueryResponse = {
  readonly status: ResponseStatus
  readonly apiId: LawApiId
  readonly categoryId: LawApiConfig["categoryId"]
  readonly operation: LawApiConfig["operation"]
  readonly source: "국가법령정보 공동활용 Open API"
  readonly sourceUrl: string
  readonly retrievedAt: string
  readonly data: Readonly<Record<string, unknown>>
  readonly bodyReferences: readonly LawApiBodyReference[]
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export class LawApiProvider {
  private readonly http: LawHttpClient
  private readonly bodyResolver: LawApiBodyResolver
  private readonly cache: TtlCache<LawApiQueryResponse>

  constructor(private readonly config: LawProviderConfig) {
    const baseUrl = config.baseUrl ?? "https://www.law.go.kr/DRF"
    this.http = new LawHttpClient({
      baseUrl,
      timeoutMs: config.timeoutMs ?? 10_000,
      retryLimit: config.retryLimit ?? 2,
      maxTextResponseBytes: config.maxTextResponseBytes ?? 8 * 1024 * 1024,
      maxResourceResponseBytes: config.maxResourceResponseBytes ?? 25 * 1024 * 1024,
    })
    this.cache = new TtlCache(config.cacheTtlMs ?? 300_000)
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
      return failure(api, retrievedAt, {
        code: "AUTH_REQUIRED",
        message: "LAW_API_OC 환경변수가 설정되지 않았습니다",
      })
    }
    const missing = api.requiredInputs.find((name) => inputValue(input, name) === undefined)
    if (missing !== undefined) {
      return failure(api, retrievedAt, {
        code: "INVALID_ARGUMENT",
        message: `${missing} 입력이 필요합니다`,
      })
    }
    const key = apiQueryCacheKey(input)
    if (input.forceRefresh !== true) {
      const cached = this.cache.get(key)
      if (cached !== undefined) return cached
    }

    try {
      const text = await this.http.get(
        api.endpoint,
        buildSearchParams(api, input, this.config.apiKey ?? ""),
      )
      const { data, status } = parseLawApiResponse(text, api)
      const response: LawApiQueryResponse = {
        status,
        apiId: api.id,
        categoryId: api.categoryId,
        operation: api.operation,
        source: "국가법령정보 공동활용 Open API",
        sourceUrl: sourceUrl(api),
        retrievedAt,
        data,
        bodyReferences: extractLawApiBodyReferences(api, data),
        errors: [],
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

function buildSearchParams(
  api: LawApiConfig,
  input: LawApiQueryInput,
  apiKey: string,
): Readonly<Record<string, string>> {
  const params: Record<string, string> = {
    OC: apiKey,
    target: api.target,
    type: "JSON",
    ...api.staticParameters,
  }
  addInput(params, api.inputParameters?.query, input.query)
  addInput(params, api.inputParameters?.documentId, input.documentId)
  addInput(params, api.inputParameters?.customCode, input.customCode)
  addInput(params, api.inputParameters?.articleNumber, input.articleNumber)
  if (api.paginated === true) {
    params["display"] = String(Math.min(input.limit ?? 20, 100))
    params["page"] = String(input.page ?? 1)
  }
  return params
}

function apiQueryCacheKey(input: LawApiQueryInput): string {
  return JSON.stringify([
    input.apiId,
    input.query ?? "",
    input.documentId ?? "",
    input.customCode ?? "",
    input.articleNumber ?? "",
    input.limit ?? "",
    input.page ?? "",
  ])
}

function addInput(
  params: Record<string, string>,
  parameter: string | undefined,
  value: string | undefined,
): void {
  if (parameter !== undefined && value !== undefined) params[parameter] = value
}

function inputValue(input: LawApiQueryInput, name: LawApiInputName): string | undefined {
  switch (name) {
    case "query":
      return input.query
    case "documentId":
      return input.documentId
    case "customCode":
      return input.customCode
    case "articleNumber":
      return input.articleNumber
    default:
      return assertNever(name)
  }
}

function failure(
  api: LawApiConfig,
  retrievedAt: string,
  error: { readonly code: string; readonly message: string },
): LawApiQueryResponse {
  return {
    status: "SOURCE_UNAVAILABLE",
    apiId: api.id,
    categoryId: api.categoryId,
    operation: api.operation,
    source: "국가법령정보 공동활용 Open API",
    sourceUrl: sourceUrl(api),
    retrievedAt,
    data: {},
    bodyReferences: [],
    errors: [error],
  }
}

function sourceUrl(api: LawApiConfig): string {
  return `https://www.law.go.kr/DRF/${api.endpoint}?target=${api.target}`
}

function toErrorShape(error: Error): { readonly code: string; readonly message: string } {
  if (error instanceof DapaError) {
    return { code: error.code, message: sanitizeUrlString(error.message) }
  }
  return { code: "INTERNAL_ERROR", message: sanitizeUrlString(error.message) }
}

function assertNever(value: never): never {
  throw new DapaError("INTERNAL_ERROR", `처리할 수 없는 입력 형식: ${String(value)}`)
}
