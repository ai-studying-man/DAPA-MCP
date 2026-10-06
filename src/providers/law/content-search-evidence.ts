import { z } from "zod"
import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { LegalDocumentDetail } from "../../types/results.js"
import { dateValue } from "./law-temporal-data.js"

const RecordSchema = z.record(z.string(), z.unknown())
const MAX_MATCHING_ARTICLES = 3
const MAX_MATCHING_AUXILIARY_SECTIONS = 2
const MAX_EXCERPTS = 5
const MAX_EXCERPT_CHARS = 6_000
const SUBSTANTIVE_KEY = /(내용|요지|사항|이유|주문|회답|답변|판결|결정)/u
const MENU_PLACEHOLDER = /자세한 내용은 상단 메뉴|<img\b/iu

export type EvidenceCoverage = {
  readonly matchingSections: number
  readonly returnedSections: number
  readonly truncated: boolean
}

export function selectMatchingDetail(
  detail: LegalDocumentDetail,
  queries: readonly string[],
  asOfDate?: string,
): LegalDocumentDetail | undefined {
  const eligible =
    asOfDate === undefined
      ? detail
      : {
          ...detail,
          articles: detail.articles.filter(
            (article) => article.effectiveDate === undefined || article.effectiveDate <= asOfDate,
          ),
        }
  for (const query of queries) {
    const matching = selectDetailForQuery(eligible, query)
    if (matching !== undefined)
      return {
        ...matching,
        articles: matching.articles.slice(0, MAX_MATCHING_ARTICLES),
        supplementaryProvisions: matching.supplementaryProvisions.slice(
          0,
          MAX_MATCHING_AUXILIARY_SECTIONS,
        ),
        annexes: matching.annexes.slice(0, MAX_MATCHING_AUXILIARY_SECTIONS),
        forms: matching.forms.slice(0, MAX_MATCHING_AUXILIARY_SECTIONS),
      }
  }
  return undefined
}

function selectDetailForQuery(
  detail: LegalDocumentDetail,
  query: string,
): LegalDocumentDetail | undefined {
  const queries = [query]
  const articles = detail.articles.filter((article) =>
    textContainsAnyQuery(`${article.title ?? ""} ${article.text}`, queries),
  )
  const supplementaryProvisions = detail.supplementaryProvisions.filter((provision) =>
    textContainsAnyQuery(provision.text, queries),
  )
  const annexes = detail.annexes.filter((annex) =>
    textContainsAnyQuery(`${annex.name ?? ""} ${annex.text}`, queries),
  )
  const forms = detail.forms.filter((form) =>
    textContainsAnyQuery(`${form.name ?? ""} ${form.text}`, queries),
  )
  const amendmentText = matchingOptionalText(detail.amendmentText, queries)
  const amendmentReason = matchingOptionalText(detail.amendmentReason, queries)
  if (
    articles.length === 0 &&
    supplementaryProvisions.length === 0 &&
    annexes.length === 0 &&
    forms.length === 0 &&
    amendmentText === undefined &&
    amendmentReason === undefined
  ) {
    return undefined
  }
  return {
    ...(detail.lawKey === undefined ? {} : { lawKey: detail.lawKey }),
    basicInfo: detail.basicInfo,
    articles,
    supplementaryProvisions,
    annexes,
    forms,
    ...(amendmentText === undefined ? {} : { amendmentText }),
    ...(amendmentReason === undefined ? {} : { amendmentReason }),
  }
}

export function matchingDetailCoverage(
  detail: LegalDocumentDetail,
  queries: readonly string[],
  asOfDate?: string,
): EvidenceCoverage {
  const eligible = {
    ...detail,
    articles: detail.articles.filter(
      (article) =>
        asOfDate === undefined ||
        article.effectiveDate === undefined ||
        article.effectiveDate <= asOfDate,
    ),
  }
  const matching = queries
    .map((query) => selectDetailForQuery(eligible, query))
    .find((value) => value !== undefined)
  if (matching === undefined) return { matchingSections: 0, returnedSections: 0, truncated: false }
  const counts = [
    matching.articles.length,
    matching.supplementaryProvisions.length,
    matching.annexes.length,
    matching.forms.length,
  ]
  const optional =
    Number(matching.amendmentText !== undefined) + Number(matching.amendmentReason !== undefined)
  const matchingSections = counts.reduce((sum, count) => sum + count, optional)
  const returnedSections = counts.reduce(
    (sum, count, index) =>
      sum + Math.min(count, index === 0 ? MAX_MATCHING_ARTICLES : MAX_MATCHING_AUXILIARY_SECTIONS),
    optional,
  )
  return { matchingSections, returnedSections, truncated: matchingSections > returnedSections }
}

export function extractMatchingExcerpts(
  rawContent: string | undefined,
  queries: readonly string[],
  asOfDate?: string,
): readonly string[] {
  return extractExcerptEvidence(rawContent, queries, asOfDate).excerpts
}

export function extractExcerptEvidence(
  rawContent: string | undefined,
  queries: readonly string[],
  asOfDate?: string,
): { readonly excerpts: readonly string[]; readonly coverage: EvidenceCoverage } {
  const empty = {
    excerpts: [],
    coverage: { matchingSections: 0, returnedSections: 0, truncated: false },
  }
  if (rawContent === undefined) return empty
  const parsed: unknown = JSON.parse(rawContent)
  for (const query of queries) {
    const matches: string[] = []
    collectMatchingText(parsed, "", {
      queries: [query],
      matches,
      ...(asOfDate === undefined ? {} : { asOfDate }),
    })
    if (matches.length > 0) {
      const unique = [...new Set(matches)]
      const excerpts = unique.slice(0, MAX_EXCERPTS).map((text) => boundedExcerpt(text, [query]))
      return {
        excerpts,
        coverage: {
          matchingSections: unique.length,
          returnedSections: excerpts.length,
          truncated:
            unique.length > excerpts.length ||
            unique.slice(0, MAX_EXCERPTS).some((text) => text.length > MAX_EXCERPT_CHARS),
        },
      }
    }
  }
  return empty
}

export function firstMatchingQueryIndex(text: string, queries: readonly string[]): number {
  return queries.findIndex((query) => textContainsAnyQuery(text, [query]))
}

type ExcerptSearch = {
  readonly queries: readonly string[]
  readonly matches: string[]
  readonly asOfDate?: string
}

function collectMatchingText(value: unknown, key: string, search: ExcerptSearch): void {
  const { queries, matches } = search
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim()
    if (
      SUBSTANTIVE_KEY.test(key) &&
      !MENU_PLACEHOLDER.test(text) &&
      textContainsAnyQuery(text, queries)
    ) {
      matches.push(text)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const child of value) collectMatchingText(child, key, search)
    return
  }
  const record = RecordSchema.safeParse(value)
  if (!record.success) return
  const effectiveDate = dateValue(record.data["조문시행일자"])
  if (
    search.asOfDate !== undefined &&
    effectiveDate !== undefined &&
    effectiveDate > search.asOfDate
  )
    return
  for (const [childKey, child] of Object.entries(record.data)) {
    collectMatchingText(child, childKey, search)
  }
}

function boundedExcerpt(text: string, queries: readonly string[]): string {
  if (text.length <= MAX_EXCERPT_CHARS) return text
  const anchor = queries.map((query) => text.indexOf(query)).find((index) => index >= 0)
  const center = anchor ?? 0
  const start = Math.max(0, center - Math.floor(MAX_EXCERPT_CHARS / 2))
  const end = Math.min(text.length, start + MAX_EXCERPT_CHARS)
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`
}

function matchingOptionalText(
  value: string | undefined,
  queries: readonly string[],
): string | undefined {
  return value !== undefined && textContainsAnyQuery(value, queries) ? value : undefined
}

function textContainsAnyQuery(text: string, queries: readonly string[]): boolean {
  const body = normalizeSearchText(text)
  return queries.some((query) => {
    const normalizedQuery = normalizeSearchText(query)
    if (normalizedQuery.length > 0 && body.includes(normalizedQuery)) return true
    const tokens = query
      .split(/[^0-9A-Za-z가-힣]+/u)
      .map(normalizeSearchText)
      .filter((token) => token.length >= 2)
    return tokens.length > 0 && tokens.every((token) => body.includes(token))
  })
}
