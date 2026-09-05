import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { DapaSearchResult, SourceType } from "../../types/results.js"

export const LEGAL_CONTENT_SEARCH_MODES = ["fast", "thorough"] as const
export type LegalContentSearchMode = (typeof LEGAL_CONTENT_SEARCH_MODES)[number]

export const SEARCH_PROFILES = {
  fast: {
    queryVariants: 2,
    searchPages: 1,
    maxDocuments: 5,
    initialDocuments: 3,
    detailConcurrency: 3,
  },
  thorough: {
    queryVariants: 3,
    searchPages: 2,
    maxDocuments: 10,
    initialDocuments: 10,
    detailConcurrency: 4,
  },
} as const satisfies Record<
  LegalContentSearchMode,
  {
    readonly queryVariants: number
    readonly searchPages: number
    readonly maxDocuments: number
    readonly initialDocuments: number
    readonly detailConcurrency: number
  }
>

const QUESTION_WORDS = new Set([
  "관련",
  "규정",
  "법령",
  "절차",
  "내용",
  "질문",
  "또는",
  "적용",
  "근거",
  "기준",
  "제재",
  "관련된",
  "관련한",
  "헌법재판소결정례",
  "헌재결정례",
  "판례",
  "행정심판례",
  "알려줘",
  "알려주세요",
  "설명해줘",
  "설명해주세요",
])
const LEGAL_DOCUMENT_TERM = /(법|법령|시행령|시행규칙|규정)$/u

export type ContentQueryPlan = {
  readonly searchQueries: readonly string[]
  readonly evidenceQueries: readonly string[]
}

export function inferLegalSourceTypes(query: string): readonly SourceType[] {
  const inferred: SourceType[] = []
  const documentQuery = query.replace(/법령해석례?/gu, "")
  if (/(?:법령|법률|시행령|시행규칙)/u.test(documentQuery)) inferred.push("law")
  if (/(?:행정규칙|규정|훈령|예규|고시)/u.test(query)) inferred.push("administrative_rule")
  if (/(?:자치법규|조례)/u.test(query)) inferred.push("local_ordinance")
  if (/(?:판례|대법원|법원)/u.test(query)) inferred.push("precedent")
  if (/(?:헌재|헌법재판)/u.test(query)) inferred.push("constitutional_case")
  if (/(?:법령해석례|법령해석)/u.test(query)) inferred.push("interpretation")
  if (/(?:행정심판례|행정심판|재결례)/u.test(query)) inferred.push("administrative_appeal")
  return inferred.length === 0 ? ["law", "administrative_rule"] : inferred
}

export function planContentSearch(query: string): ContentQueryPlan {
  const collapsed = query.replace(/\s+/gu, " ").trim()
  const tokens = collapsed.split(/[^0-9A-Za-z가-힣]+/u).filter((value) => value.length > 0)
  const compact = tokens.length <= 4 ? collapsed.replace(/\s+/gu, "") : undefined
  const coreTerms = tokens
    .map(stripKoreanParticle)
    .filter((value) => value.length >= 2 && !QUESTION_WORDS.has(value))
  const issueTerms = coreTerms
    .filter((value) => !isDocumentContext(value))
    .sort((left, right) => right.length - left.length)
  const contextTerms = coreTerms
    .filter(isDocumentContext)
    .sort((left, right) => contextScore(right) - contextScore(left))
  const ordered = [issueTerms[0], contextTerms[0], collapsed, compact, ...coreTerms]
  const searchQueries = [...new Set(ordered)].filter(
    (value): value is string => value !== undefined && value.length > 0,
  )
  return {
    searchQueries,
    evidenceQueries: [...new Set([issueTerms[0], ...contextTerms, ...issueTerms.slice(1)])].filter(
      (value): value is string => value !== undefined,
    ),
  }
}

export function expandSearchQueries(query: string): readonly string[] {
  return planContentSearch(query).searchQueries
}

export function isDocumentTitleQuery(value: string): boolean {
  return LEGAL_DOCUMENT_TERM.test(value)
}

function isDocumentContext(value: string): boolean {
  return isDocumentTitleQuery(value) || value.startsWith("방위사업청") || value === "국방부"
}

function contextScore(value: string): number {
  return value.length + (isDocumentTitleQuery(value) ? 100 : 0)
}

export function rankCandidates(
  candidates: readonly DapaSearchResult[],
  queries: readonly string[],
): readonly DapaSearchResult[] {
  return candidates
    .map((document, index) => ({
      document,
      index,
      score: dapaRelevanceScore(document) + titleRelevanceScore(document.title, queries),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ document }) => document)
}

export function titleRelevanceScore(title: string, queries: readonly string[]): number {
  const normalizedTitle = normalizeSearchText(title)
  return queries.reduce((score, query) => {
    const normalizedQuery = normalizeSearchText(query)
    if (normalizedTitle === normalizedQuery) return Math.max(score, 100)
    if (normalizedQuery.includes(normalizedTitle)) return Math.max(score, 80)
    if (normalizedTitle.includes(normalizedQuery)) {
      const distance = Math.min(normalizedTitle.length - normalizedQuery.length, 19)
      return Math.max(score, 40 - distance)
    }
    return score
  }, 0)
}

function dapaRelevanceScore(document: DapaSearchResult): number {
  const title = normalizeSearchText(document.title)
  const organization = normalizeSearchText(document.organization ?? "")
  const organizationScore = organization.includes("방위사업청")
    ? 30
    : organization.includes("국방부")
      ? 10
      : 0
  const titleScore = title.includes("방위사업") || title.includes("국방전력") ? 20 : 0
  return organizationScore + titleScore
}

function stripKoreanParticle(value: string): string {
  if (value.length <= 2) return value
  return value.replace(
    /(?:에서|에게|으로|까지|부터|처럼|보다|은|는|이|가|을|를|와|과|의|에|도|만)$/u,
    "",
  )
}
