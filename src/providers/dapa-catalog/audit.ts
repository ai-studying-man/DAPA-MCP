import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { DapaSearchResult } from "../../types/results.js"
import type { LegalContentSource } from "./content.js"
import {
  searchDapaLegalForCatalog,
  selectDapaLegalCandidates,
  selectDapaLegalMatches,
} from "./content.js"
import type { DapaCatalogFile, DapaCatalogItem } from "./schemas.js"

export const DAPA_COVERAGE_STATUSES = [
  "matched",
  "title_variant",
  "missing",
  "metadata_mismatch",
  "external_only",
  "source_unavailable",
] as const

export type DapaCoverageStatus = (typeof DAPA_COVERAGE_STATUSES)[number]

export type DapaCoverageItem = {
  readonly id: string
  readonly kind: DapaCatalogItem["kind"]
  readonly title: string
  readonly category: DapaCatalogItem["category"]
  readonly sourceUrl: string
  readonly listNumber?: number
  readonly dapaRegistrationId?: string
  readonly promulgationNumber?: string
  readonly promulgationDate?: string
  readonly lawGoKrUrl?: string
  readonly externalFileUrl?: string
  readonly status: DapaCoverageStatus
  readonly matchedDocumentIds: readonly string[]
  readonly reason?: string
}

export type DapaCoverageReport = {
  readonly generatedAt: string
  readonly totals: {
    readonly total: number
    readonly matched: number
    readonly titleVariant: number
    readonly missing: number
    readonly metadataMismatch: number
    readonly externalOnly: number
    readonly sourceUnavailable: number
  }
  readonly items: readonly DapaCoverageItem[]
  readonly missing: readonly DapaCoverageItem[]
}

export type DapaCoverageAuditConfig = {
  readonly concurrency?: number
}

export async function auditDapaCatalogCoverage(
  catalog: DapaCatalogFile,
  law: LegalContentSource,
  config: DapaCoverageAuditConfig = {},
): Promise<DapaCoverageReport> {
  const groups = groupItems(catalog.items)
  const searchResults = new Map<string, SearchGroupResult>()
  const concurrency = Math.max(1, Math.min(config.concurrency ?? 4, 10))
  const groupList = [...groups.entries()]
  const bulkAdministrativeRules = await law.listAllAdministrativeRules?.()
  if (bulkAdministrativeRules !== undefined) {
    for (const [key, items] of groupList) {
      if (items[0]?.kind !== "admin_rule") continue
      searchResults.set(
        key,
        bulkAdministrativeRules.status === "SOURCE_UNAVAILABLE"
          ? {
              kind: "unavailable",
              reason:
                bulkAdministrativeRules.errors[0]?.message ??
                "국가법령정보 API를 사용할 수 없습니다",
            }
          : { kind: "results", results: bulkAdministrativeRules.results },
      )
    }
  }
  const pendingGroups = groupList.filter(([key]) => !searchResults.has(key))
  for (let offset = 0; offset < pendingGroups.length; offset += concurrency) {
    const batch = pendingGroups.slice(offset, offset + concurrency)
    const settled = await Promise.all(
      batch.map(async ([key, items]) => [key, await searchGroup(law, items[0])] as const),
    )
    for (const [key, result] of settled) searchResults.set(key, result)
  }

  const items = catalog.items.map((item) => classifyItem(item, searchResults.get(groupKey(item))))
  const missing = items.filter((item) => item.status === "missing")
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      total: items.length,
      matched: countStatus(items, "matched"),
      titleVariant: countStatus(items, "title_variant"),
      missing: missing.length,
      metadataMismatch: countStatus(items, "metadata_mismatch"),
      externalOnly: countStatus(items, "external_only"),
      sourceUnavailable: countStatus(items, "source_unavailable"),
    },
    items,
    missing,
  }
}

type SearchGroupResult =
  | { readonly kind: "results"; readonly results: readonly DapaSearchResult[] }
  | { readonly kind: "unavailable"; readonly reason: string }

async function searchGroup(
  law: LegalContentSource,
  item: DapaCatalogItem | undefined,
): Promise<SearchGroupResult> {
  if (item === undefined) return { kind: "unavailable", reason: "카탈로그 그룹이 비어 있습니다" }
  const response = await searchDapaLegalForCatalog(law, item)
  if (response.status === "SOURCE_UNAVAILABLE") {
    return {
      kind: "unavailable",
      reason: response.errors[0]?.message ?? "국가법령정보 API를 사용할 수 없습니다",
    }
  }
  return { kind: "results", results: response.results }
}

function classifyItem(
  item: DapaCatalogItem,
  result: SearchGroupResult | undefined,
): DapaCoverageItem {
  const base = {
    id: item.id,
    kind: item.kind,
    title: item.title,
    category: item.category,
    sourceUrl: item.sourceUrl,
    ...(item.kind === "admin_rule"
      ? {
          listNumber: item.listNumber,
          dapaRegistrationId: item.dapaRegistrationId,
          promulgationNumber: item.promulgationNumber,
          promulgationDate: item.promulgationDate,
        }
      : {
          ...(item.lawGoKrUrl === undefined ? {} : { lawGoKrUrl: item.lawGoKrUrl }),
          ...(item.externalFileUrl === undefined ? {} : { externalFileUrl: item.externalFileUrl }),
        }),
  }
  if (item.kind === "law" && item.lawGoKrUrl === undefined) {
    return {
      ...base,
      status: "external_only",
      matchedDocumentIds: [],
      reason: "국가법령정보 링크가 없습니다",
    }
  }
  if (result === undefined || result.kind === "unavailable") {
    return {
      ...base,
      status: "source_unavailable",
      matchedDocumentIds: [],
      ...(result === undefined ? {} : { reason: result.reason }),
    }
  }
  const titleMatches = result.results.filter(
    (candidate) => normalizeSearchText(candidate.title) === normalizeSearchText(item.title),
  )
  const matches = selectDapaLegalMatches(item, result.results)
  if (matches.length > 0) {
    const metadataOnly = item.kind === "admin_rule" && titleMatches.length === 0
    return {
      ...base,
      status: metadataOnly ? "title_variant" : "matched",
      matchedDocumentIds: matches.map((match) => match.documentId),
      ...(metadataOnly
        ? { reason: "발령번호·발령일자는 일치하지만 API canonical 제목이 다릅니다" }
        : {}),
    }
  }
  if (titleMatches.length > 0) {
    return {
      ...base,
      status: "metadata_mismatch",
      matchedDocumentIds: titleMatches.map((match) => match.documentId),
      reason: "제목은 일치하지만 발령번호·발령일자가 일치하지 않습니다",
    }
  }
  const variantMatches = selectDapaLegalCandidates(item, result.results)
  if (variantMatches.length > 0) {
    return {
      ...base,
      status: "title_variant",
      matchedDocumentIds: variantMatches.map((match) => match.documentId),
      reason: "API canonical 제목이 DAPA 표시 제목과 다르지만 대응 문서 후보로 확인됩니다",
    }
  }
  return {
    ...base,
    status: "missing",
    matchedDocumentIds: [],
    reason: "국가법령정보 API에서 동일 제목을 찾지 못했습니다",
  }
}

function groupItems(items: readonly DapaCatalogItem[]): Map<string, readonly DapaCatalogItem[]> {
  const groups = new Map<string, DapaCatalogItem[]>()
  for (const item of items) {
    const key = groupKey(item)
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  return groups
}

function groupKey(item: DapaCatalogItem): string {
  return `${item.kind}:${normalizeSearchText(item.title)}`
}

function countStatus(items: readonly DapaCoverageItem[], status: DapaCoverageStatus): number {
  return items.filter((item) => item.status === status).length
}
