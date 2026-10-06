import { TtlCache } from "../../lib/cache/ttl-cache.js"
import { DapaError } from "../../lib/errors/dapa-error.js"
import type { DocumentStatus } from "../../types/results.js"
import { getLawApiConfig } from "./law-api-catalog.js"
import { parseLawApiResponse } from "./law-api-response.js"
import { koreaToday, type TemporalInput } from "./law-api-temporal.js"
import type { LawHttpClient } from "./law-http.js"
import { dateValue, type OfficialVersion, officialBasicInfo } from "./law-temporal-data.js"

export type TemporalDetail = {
  readonly text: string
  readonly documentId: string
  readonly status: DocumentStatus
}

export class LawVersionBodyCache {
  private readonly cache: TtlCache<string>
  private readonly pending = new Map<string, Promise<string>>()

  constructor(
    private readonly http: LawHttpClient,
    ttlMs: number,
  ) {
    this.cache = new TtlCache(ttlMs)
  }

  read(
    params: Readonly<Record<string, string>>,
    input: {
      readonly forceRefresh?: boolean
      readonly deadlineAt?: number
    },
  ): Promise<string> {
    const exactVersion = params["MST"] !== undefined || params["target"] === "admrul"
    const key = JSON.stringify(
      Object.entries(params)
        .filter(([name]) => name !== "OC")
        .sort(),
    )
    if (input.forceRefresh !== true) {
      const cached = exactVersion ? this.cache.get(key) : undefined
      if (cached !== undefined) return Promise.resolve(cached)
      const pending = this.pending.get(key)
      if (pending !== undefined) return pending
    }
    const request = this.http.get("lawService.do", params, input.deadlineAt).then((text) => {
      const parsed = parseLawApiResponse(
        text,
        getLawApiConfig(
          params["target"] === "admrul" ? "administrative_rule.detail" : "law.detail",
        ),
      )
      if (parsed.status === "OK" && exactVersion) this.cache.set(key, text)
      return text
    })
    this.pending.set(key, request)
    void request.then(
      () => {
        if (this.pending.get(key) === request) this.pending.delete(key)
      },
      () => {
        if (this.pending.get(key) === request) this.pending.delete(key)
      },
    )
    return request
  }
}

export function confirmTemporalDetail(
  text: string,
  version: OfficialVersion,
  input: TemporalInput,
): TemporalDetail {
  const data = parseLawApiResponse(
    text,
    getLawApiConfig(version.category === "law" ? "law.detail" : "administrative_rule.detail"),
  ).data
  const effectiveDate = dateValue(officialBasicInfo(data, version.category)["시행일자"])
  if (effectiveDate !== undefined && effectiveDate > (input.asOfDate ?? koreaToday()))
    throw new DapaError(
      "SOURCE_UNAVAILABLE",
      "공식 본문의 시행일자가 기준일 이후여서 현행 근거로 사용할 수 없습니다",
    )
  return {
    text,
    documentId: version.documentId,
    status: input.asOfDate === undefined ? "current" : version.status,
  }
}
