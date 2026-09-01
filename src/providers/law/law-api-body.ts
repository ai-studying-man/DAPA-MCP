import { DapaError } from "../../lib/errors/dapa-error.js"
import type { ResponseStatus } from "../../types/results.js"
import { retrieveLawApiAttachment } from "./law-api-attachment.js"
import {
  getLawApiBodyApiId,
  getLawApiConfig,
  type LawApiConfig,
  type LawApiId,
} from "./law-api-catalog.js"
import type { LawApiQueryInput, LawApiQueryResponse, TemporalScope } from "./law-api-provider.js"
import { sanitizeUrlString } from "./law-api-sanitize.js"
import type { LawHttpClient } from "./law-http.js"

export type LawApiBodyInput = LawApiQueryInput & {
  readonly attachmentUrl?: string
}

export type LawApiBodyResponse = {
  readonly status: ResponseStatus
  readonly requestedApiId: LawApiId
  readonly resolvedApiId?: LawApiId
  readonly resolution: LawApiConfig["bodyResolution"]
  readonly source: "국가법령정보 공동활용 Open API"
  readonly sourceUrl: string
  readonly retrievedAt: string
  readonly temporalScope: TemporalScope
  readonly data: Readonly<Record<string, unknown>>
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export class LawApiBodyResolver {
  constructor(
    private readonly http: LawHttpClient,
    private readonly siteBaseUrl: URL,
    private readonly query: (input: LawApiQueryInput) => Promise<LawApiQueryResponse>,
  ) {}

  async resolve(input: LawApiBodyInput): Promise<LawApiBodyResponse> {
    const requestedApi = getLawApiConfig(input.apiId)
    const retrievedAt = new Date().toISOString()
    if (requestedApi.bodyResolution === "download_link") {
      return this.resolveAttachment(requestedApi, input.attachmentUrl, retrievedAt)
    }

    const resolvedApiId = getLawApiBodyApiId(input.apiId)
    if (resolvedApiId === undefined) {
      return failure(requestedApi, retrievedAt, {
        code: "INTERNAL_ERROR",
        message: "본문 API 연결 설정이 없습니다",
      })
    }
    const response = await this.query({
      apiId: resolvedApiId,
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.documentId === undefined ? {} : { documentId: input.documentId }),
      ...(input.customCode === undefined ? {} : { customCode: input.customCode }),
      ...(input.articleNumber === undefined ? {} : { articleNumber: input.articleNumber }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.page === undefined ? {} : { page: input.page }),
      ...(input.currentOnly === undefined ? {} : { currentOnly: input.currentOnly }),
      ...(input.asOfDate === undefined ? {} : { asOfDate: input.asOfDate }),
      ...(input.forceRefresh === undefined ? {} : { forceRefresh: input.forceRefresh }),
    })
    return {
      status: response.status,
      requestedApiId: requestedApi.id,
      resolvedApiId,
      resolution: requestedApi.bodyResolution,
      source: response.source,
      sourceUrl: response.sourceUrl,
      retrievedAt: response.retrievedAt,
      temporalScope: response.temporalScope,
      data: response.data,
      errors: response.errors,
    }
  }

  private async resolveAttachment(
    api: LawApiConfig,
    attachmentUrl: string | undefined,
    retrievedAt: string,
  ): Promise<LawApiBodyResponse> {
    if (attachmentUrl === undefined) {
      return failure(api, retrievedAt, {
        code: "INVALID_ARGUMENT",
        message: "목록 응답의 별표서식파일링크 또는 별표서식PDF파일링크가 필요합니다",
      })
    }
    try {
      const attachment = await retrieveLawApiAttachment(this.http, this.siteBaseUrl, attachmentUrl)
      return {
        status: "OK",
        requestedApiId: api.id,
        resolution: api.bodyResolution,
        source: "국가법령정보 공동활용 Open API",
        sourceUrl: attachment.sourceUrl,
        retrievedAt,
        temporalScope: "not_applicable",
        data: { attachment },
        errors: [],
      }
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
}

function failure(
  api: LawApiConfig,
  retrievedAt: string,
  error: { readonly code: string; readonly message: string },
): LawApiBodyResponse {
  return {
    status: "SOURCE_UNAVAILABLE",
    requestedApiId: api.id,
    resolution: api.bodyResolution,
    source: "국가법령정보 공동활용 Open API",
    sourceUrl: `https://www.law.go.kr/DRF/${api.endpoint}?target=${api.target}`,
    retrievedAt,
    temporalScope: "not_applicable",
    data: {},
    errors: [error],
  }
}

function toErrorShape(error: Error): { readonly code: string; readonly message: string } {
  if (error instanceof DapaError) {
    return { code: error.code, message: sanitizeUrlString(error.message) }
  }
  return { code: "INTERNAL_ERROR", message: sanitizeUrlString(error.message) }
}
