import { z } from "zod"
import { DapaError } from "../../lib/errors/dapa-error.js"
import type { DapaSearchResult, DocumentStatus } from "../../types/results.js"
import { removeOcSearchParams, sanitizeUrlString } from "./law-api-sanitize.js"
import type { LawTargetConfig } from "./target-config.js"

const SearchEnvelopeSchema = z.record(z.string(), z.unknown())
const SearchBodySchema = z
  .object({ totalCnt: z.coerce.number().int().nonnegative() })
  .catchall(z.unknown())
const ItemSchema = z.record(z.string(), z.unknown())

export type ParsedSearchResponse = {
  readonly totalCount: number
  readonly results: readonly DapaSearchResult[]
}

export function parseLawSearchResponse(
  text: string,
  config: LawTargetConfig,
  retrievedAt: string,
): ParsedSearchResponse {
  if (/^\s*</.test(text)) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API가 JSON 대신 HTML/XML을 반환했습니다")
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API JSON 응답을 파싱할 수 없습니다", {
      cause: error,
    })
  }

  const envelope = SearchEnvelopeSchema.safeParse(json)
  const body = envelope.success
    ? SearchBodySchema.safeParse(envelope.data[config.rootKey])
    : undefined
  if (body === undefined || !body.success) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API 응답 구조가 예상 형식과 다릅니다")
  }

  const rawItems = toItems(body.data[config.itemKey])
  const results = rawItems.map((item) => toSearchResult(item, config, retrievedAt))
  if (body.data.totalCnt > 0 && results.length === 0) {
    throw new DapaError(
      "SOURCE_UNAVAILABLE",
      "법제처 API가 건수만 반환하고 결과 항목을 누락했습니다",
    )
  }
  return { totalCount: body.data.totalCnt, results }
}

function toItems(value: unknown): readonly Record<string, unknown>[] {
  if (value === undefined || value === null) return []
  const candidates = Array.isArray(value) ? value : [value]
  return candidates.map((candidate) => ItemSchema.parse(candidate))
}

function toSearchResult(
  item: Record<string, unknown>,
  config: LawTargetConfig,
  retrievedAt: string,
): DapaSearchResult {
  const id = firstString(item, config.idKeys)
  const title = firstString(item, config.titleKeys)
  if (id === undefined || title === undefined) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 검색 항목에 문서 ID 또는 제목이 없습니다")
  }
  const organization = firstString(item, config.organizationKeys)
  const sourceUrl = toSourceUrl(firstString(item, config.linkKeys))
  const reference = firstString(item, config.referenceKeys)
  const date = formatDate(firstString(item, config.dateKeys))
  const effectiveDate = formatDate(firstString(item, config.effectiveDateKeys))
  const status = toStatus(item["현행연혁코드"])
  return {
    id,
    source: "국가법령정보 공동활용 Open API",
    sourceType: config.sourceType,
    title,
    ...(reference === undefined ? {} : { summary: reference }),
    ...(organization === undefined ? {} : { organization }),
    ...(date === undefined ? {} : { date }),
    ...(effectiveDate === undefined ? {} : { effectiveDate }),
    status,
    verified: true,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    retrievedAt,
    documentId: id,
  }
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" || typeof value === "number") return String(value)
  }
  return undefined
}

function formatDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const digits = value.replace(/[^0-9]/g, "")
  if (!/^\d{8}$/.test(digits)) return value
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function toSourceUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const absolute = /^https?:\/\//.test(value)
    ? value
    : `https://www.law.go.kr${value.startsWith("/") ? "" : "/"}${value}`
  try {
    const url = new URL(absolute.replaceAll("&amp;", "&"))
    removeOcSearchParams(url)
    return url.toString()
  } catch (error) {
    if (error instanceof TypeError) return sanitizeUrlString(absolute)
    throw error
  }
}

function toStatus(value: unknown): DocumentStatus {
  if (value === "현행") return "current"
  if (value === "연혁") return "historical"
  if (value === "폐지") return "repealed"
  return "unknown"
}
