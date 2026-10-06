import { z } from "zod"
import { DapaError } from "../../lib/errors/dapa-error.js"
import type { DocumentStatus } from "../../types/results.js"
import type { TemporalInput } from "./law-api-temporal.js"
import { koreaToday } from "./law-api-temporal.js"

const RecordSchema = z.record(z.string(), z.unknown())
export type TemporalCategory = "law" | "administrative_rule"
export type OfficialVersion = {
  readonly category: TemporalCategory
  readonly documentId: string
  readonly title: string
  readonly stableId?: string
  readonly effectiveDate?: string
  readonly status: DocumentStatus
}

export function officialStatus(value: unknown): DocumentStatus {
  if (value === "현행" || value === "현행법령") return "current"
  if (value === "연혁" || value === "연혁법령") return "historical"
  if (value === "폐지") return "repealed"
  if (value === "시행예정" || value === "예정") return "amended"
  return "unknown"
}

export function effectiveStatus(item: Readonly<Record<string, unknown>>): DocumentStatus {
  return item["effectiveStatus"] === "current" && item["effectiveAsOfDate"] === koreaToday()
    ? "current"
    : officialStatus(item["현행연혁코드"] ?? item["현행연혁구분"])
}

export function officialList(data: Readonly<Record<string, unknown>>, category: TemporalCategory) {
  const rootKey = category === "law" ? "LawSearch" : "AdmRulSearch"
  const itemKey = category === "law" ? "law" : "admrul"
  const parsed = RecordSchema.safeParse(data[rootKey])
  if (!parsed.success)
    throw new DapaError("SOURCE_UNAVAILABLE", "공식 API 목록 응답 구조를 확인할 수 없습니다")
  const root = parsed.data
  const raw = root[itemKey]
  const items =
    raw === undefined
      ? []
      : (Array.isArray(raw) ? raw : [raw]).map((item) => RecordSchema.parse(item))
  return { rootKey, itemKey, root, items }
}

export function versionOf(
  item: Readonly<Record<string, unknown>>,
  category: TemporalCategory,
): OfficialVersion {
  const prefix = category === "law" ? "법령" : "행정규칙"
  const documentId = scalar(item[`${prefix}일련번호`])
  const title = scalar(item[category === "law" ? "법령명한글" : "행정규칙명"])
  if (documentId === undefined || title === undefined)
    throw new DapaError("SOURCE_UNAVAILABLE", "공식 목록에서 문서 식별자를 확인할 수 없습니다")
  const stableId = scalar(item[`${prefix}ID`])
  const effectiveDate = dateValue(item["시행일자"])
  return {
    category,
    documentId,
    title,
    status: effectiveStatus(item),
    ...(stableId === undefined ? {} : { stableId }),
    ...(effectiveDate === undefined ? {} : { effectiveDate }),
  }
}

export function activeOn(version: OfficialVersion, date: string): boolean {
  return (
    version.status !== "repealed" &&
    (version.effectiveDate === undefined || version.effectiveDate <= date)
  )
}

export function filterOfficialList(
  data: Readonly<Record<string, unknown>>,
  category: TemporalCategory,
  input: TemporalInput,
): Readonly<Record<string, unknown>> {
  if (input.currentOnly === false && input.asOfDate === undefined) return data
  const { rootKey, itemKey, root, items } = officialList(data, category)
  const date = input.asOfDate ?? koreaToday()
  const eligible = items.filter((item) => {
    const version = versionOf(item, category)
    return (
      activeOn(version, date) &&
      (input.asOfDate !== undefined ||
        (version.status !== "historical" && version.status !== "amended"))
    )
  })
  const selected = input.asOfDate === undefined ? eligible : newestPerIdentity(eligible, category)
  return {
    ...data,
    [rootKey]: {
      ...root,
      [itemKey]: selected,
      upstreamFetchedCount: root["upstreamFetchedCount"] ?? items.length,
      returnedCount: selected.length,
    },
  }
}

export function mergeOfficialLists(
  first: Readonly<Record<string, unknown>>,
  second: Readonly<Record<string, unknown>>,
  category: TemporalCategory,
): Readonly<Record<string, unknown>> {
  const a = officialList(first, category)
  const b = officialList(second, category)
  const items = [
    ...new Map(
      [...a.items, ...b.items].map((item) => [versionOf(item, category).documentId, item]),
    ).values(),
  ]
  return {
    ...first,
    [a.rootKey]: {
      ...a.root,
      totalCnt: String(Number(a.root["totalCnt"]) + Number(b.root["totalCnt"])),
      upstreamTotalCounts: [Number(a.root["totalCnt"]), Number(b.root["totalCnt"])],
      upstreamFetchedCount: a.items.length + b.items.length,
      [a.itemKey]: items,
    },
  }
}

function newestPerIdentity(items: readonly Record<string, unknown>[], category: TemporalCategory) {
  const selected = new Map<string, Record<string, unknown>>()
  for (const item of items) {
    const version = versionOf(item, category)
    const key = version.stableId ?? version.title
    const prior = selected.get(key)
    if (
      prior === undefined ||
      (version.effectiveDate ?? "") > (versionOf(prior, category).effectiveDate ?? "")
    )
      selected.set(key, item)
  }
  return [...selected.values()]
}

export function scalar(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined
}

export function dateValue(value: unknown): string | undefined {
  const digits = scalar(value)?.replaceAll(/[^0-9]/g, "")
  return digits !== undefined && /^\d{8}$/.test(digits)
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : undefined
}

export function officialBasicInfo(
  data: Readonly<Record<string, unknown>>,
  category: TemporalCategory,
): Readonly<Record<string, unknown>> {
  const root = RecordSchema.safeParse(
    data[category === "law" ? "법령" : "AdmRulService"] ?? data["행정규칙"],
  )
  const info = root.success
    ? RecordSchema.safeParse(
        root.data[category === "law" ? "기본정보" : "행정규칙기본정보"] ?? root.data["기본정보"],
      )
    : undefined
  if (info === undefined || !info.success)
    throw new DapaError("SOURCE_UNAVAILABLE", "공식 본문 기본정보를 확인할 수 없습니다")
  return info.data
}
