import { DapaError } from "../../lib/errors/dapa-error.js"
import { normalizeSearchText, similarityScore } from "../../lib/normalization/text.js"
import type {
  LawProvider,
  LegalDetailInput,
  LegalSearchInput,
} from "../../providers/law/law-provider.js"
import type {
  DapaSearchResult,
  ResponseStatus,
  SearchResponse,
  SourceType,
} from "../../types/results.js"
import type { DapaCatalogProvider } from "./provider.js"
import type { DapaCatalogItem } from "./schemas.js"

export type LegalContentSource = Pick<LawProvider, "search" | "getDetail"> & {
  readonly listAllAdministrativeRules?: () => Promise<SearchResponse>
}

export type DapaLegalContentResponse = {
  readonly status: ResponseStatus
  readonly catalogItem?: DapaCatalogItem
  readonly matchedDocument?: DapaSearchResult
  readonly legal?: SearchResponse
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export async function searchDapaLegalForCatalog(
  law: LegalContentSource,
  item: DapaCatalogItem,
): Promise<SearchResponse> {
  const sourceType = sourceTypeFor(item)
  const input: LegalSearchInput = {
    query: item.title,
    types: [sourceType],
    currentOnly: true,
    limit: 100,
  }
  const primary = await law.search(input)
  if (primary.status !== "NOT_FOUND") return primary
  const fallbackQuery = firstFallbackQuery(item.title)
  if (
    fallbackQuery === undefined ||
    normalizeSearchText(fallbackQuery) === normalizeSearchText(item.title)
  ) {
    return primary
  }
  return law.search({ ...input, query: fallbackQuery })
}

export async function getDapaLegalContent(
  catalog: DapaCatalogProvider,
  law: LegalContentSource,
  id: string,
): Promise<DapaLegalContentResponse> {
  const catalogItem = catalog.get(id)
  if (catalogItem === undefined) return notFound("DAPA 카탈로그 항목을 찾을 수 없습니다")
  if (catalogItem.kind === "law" && catalogItem.lawGoKrUrl === undefined) {
    return notFoundFor(catalogItem, "국가법령정보 링크가 없는 외부 문서입니다")
  }

  const sourceType = sourceTypeFor(catalogItem)
  const search = await searchDapaLegalForCatalog(law, catalogItem)
  if (search.status === "SOURCE_UNAVAILABLE") {
    return { status: search.status, catalogItem, errors: search.errors }
  }
  const matches = selectDapaLegalCandidates(catalogItem, search.results)
  if (matches.length === 0) {
    return {
      status: "NOT_FOUND",
      catalogItem,
      errors: [{ code: "NOT_FOUND", message: "국가법령정보 API에서 대응 문서를 찾지 못했습니다" }],
    }
  }
  if (matches.length > 1) {
    return {
      status: "PARTIAL_RESULT",
      catalogItem,
      errors: [{ code: "AMBIGUOUS", message: "국가법령정보 API 대응 문서가 여러 건입니다" }],
    }
  }

  const matchedDocument = matches[0]
  if (matchedDocument === undefined) return notFound("국가법령정보 API 대응 문서를 찾지 못했습니다")
  const detailInput: LegalDetailInput = { documentId: matchedDocument.documentId, sourceType }
  const legal = await law.getDetail(detailInput)
  return {
    status: legal.status,
    catalogItem,
    matchedDocument,
    legal,
    errors: legal.errors,
  }
}

export function selectDapaLegalMatches(
  item: DapaCatalogItem,
  results: readonly DapaSearchResult[],
): readonly DapaSearchResult[] {
  const title = normalizeSearchText(item.title)
  const titleMatches = results.filter((result) => normalizeSearchText(result.title) === title)
  if (item.kind === "law") return titleMatches
  const metadataMatches = results.filter(
    (result) =>
      result.date === item.promulgationDate &&
      matchesPromulgationNumber(result.summary, item.promulgationNumber),
  )
  return metadataMatches.length > 0 ? metadataMatches : titleMatches
}

export function selectDapaLegalCandidates(
  item: DapaCatalogItem,
  results: readonly DapaSearchResult[],
): readonly DapaSearchResult[] {
  const exactMatches = selectDapaLegalMatches(item, results)
  if (exactMatches.length > 0) return exactMatches

  const candidates = results
    .map((result) => ({ result, score: titleSimilarity(item.title, result.title) }))
    .filter(({ score }) => score >= 0.76)
  const metadataCandidates =
    item.kind === "admin_rule"
      ? results
          .filter(
            (result) =>
              result.date === item.promulgationDate &&
              matchesPromulgationNumber(result.summary, item.promulgationNumber),
          )
          .map((result) => ({ result, score: titleSimilarity(item.title, result.title) }))
      : candidates
  const pool =
    metadataCandidates.length > 0 ? metadataCandidates : item.kind === "law" ? candidates : []
  const bestScore = Math.max(...pool.map(({ score }) => score), 0)
  return pool.filter(({ score }) => score === bestScore).map(({ result }) => result)
}

function matchesPromulgationNumber(summary: string | undefined, expected: string): boolean {
  if (summary === undefined) return false
  const normalizedExpected = normalizeSearchText(expected)
  return summary
    .split(/[,/\s]+/u)
    .map(normalizeSearchText)
    .some((candidate) => candidate === normalizedExpected)
}

function titleSimilarity(left: string, right: string): number {
  return Math.max(similarityScore(left, right), similarityScore(stripDapaDecorations(left), right))
}

function stripDapaDecorations(value: string): string {
  return value
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\((?:국문|영문|한글|영어)(?:[,·/]?(?:국문|영문|한글|영어))*\)/g, "")
    .replace(/(?:_|\s)(?:전문|신구조문대조표|신구대비표)$/g, "")
}

function sourceTypeFor(item: DapaCatalogItem): Exclude<SourceType, "dapa_info"> {
  switch (item.kind) {
    case "law":
      return "law"
    case "admin_rule":
      return "administrative_rule"
    default:
      return assertNever(item)
  }
}

function firstFallbackQuery(title: string): string | undefined {
  const ignored = new Set(["제정", "폐지", "국문", "영문", "한글", "영어"])
  return title
    .split(/[^0-9A-Za-z가-힣]+/u)
    .map((token) => token.trim())
    .find((token) => token.length >= 3 && !ignored.has(token))
}

function notFound(message: string): DapaLegalContentResponse {
  return { status: "NOT_FOUND", errors: [{ code: "NOT_FOUND", message }] }
}

function notFoundFor(item: DapaCatalogItem, message: string): DapaLegalContentResponse {
  return { status: "NOT_FOUND", catalogItem: item, errors: [{ code: "NOT_FOUND", message }] }
}

function assertNever(value: never): never {
  throw new DapaError("INTERNAL_ERROR", `지원하지 않는 DAPA 문서 유형: ${String(value)}`)
}
