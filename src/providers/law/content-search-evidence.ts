import { z } from "zod"
import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { LegalDocumentDetail } from "../../types/results.js"

const RecordSchema = z.record(z.string(), z.unknown())
const MAX_MATCHING_ARTICLES = 3
const MAX_MATCHING_AUXILIARY_SECTIONS = 2
const MAX_EXCERPTS = 5
const MAX_EXCERPT_CHARS = 6_000
const SUBSTANTIVE_KEY = /(내용|요지|사항|이유|주문|회답|답변|판결|결정)/u
const MENU_PLACEHOLDER = /자세한 내용은 상단 메뉴|<img\b/iu

export function selectMatchingDetail(
  detail: LegalDocumentDetail,
  queries: readonly string[],
): LegalDocumentDetail | undefined {
  for (const query of queries) {
    const matching = selectDetailForQuery(detail, query)
    if (matching !== undefined) return matching
  }
  return undefined
}

function selectDetailForQuery(
  detail: LegalDocumentDetail,
  query: string,
): LegalDocumentDetail | undefined {
  const queries = [query]
  const articles = detail.articles
    .filter((article) => textContainsAnyQuery(`${article.title ?? ""} ${article.text}`, queries))
    .slice(0, MAX_MATCHING_ARTICLES)
  const supplementaryProvisions = detail.supplementaryProvisions
    .filter((provision) => textContainsAnyQuery(provision.text, queries))
    .slice(0, MAX_MATCHING_AUXILIARY_SECTIONS)
  const annexes = detail.annexes
    .filter((annex) => textContainsAnyQuery(`${annex.name ?? ""} ${annex.text}`, queries))
    .slice(0, MAX_MATCHING_AUXILIARY_SECTIONS)
  const forms = detail.forms
    .filter((form) => textContainsAnyQuery(`${form.name ?? ""} ${form.text}`, queries))
    .slice(0, MAX_MATCHING_AUXILIARY_SECTIONS)
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

export function extractMatchingExcerpts(
  rawContent: string | undefined,
  queries: readonly string[],
): readonly string[] {
  if (rawContent === undefined) return []
  const parsed: unknown = JSON.parse(rawContent)
  for (const query of queries) {
    const matches: string[] = []
    collectMatchingText(parsed, "", [query], matches)
    if (matches.length > 0) return [...new Set(matches)].slice(0, MAX_EXCERPTS)
  }
  return []
}

export function firstMatchingQueryIndex(text: string, queries: readonly string[]): number {
  return queries.findIndex((query) => textContainsAnyQuery(text, [query]))
}

function collectMatchingText(
  value: unknown,
  key: string,
  queries: readonly string[],
  matches: string[],
): void {
  if (matches.length >= MAX_EXCERPTS) return
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim()
    if (
      SUBSTANTIVE_KEY.test(key) &&
      !MENU_PLACEHOLDER.test(text) &&
      textContainsAnyQuery(text, queries)
    ) {
      matches.push(boundedExcerpt(text, queries))
    }
    return
  }
  if (Array.isArray(value)) {
    for (const child of value) collectMatchingText(child, key, queries, matches)
    return
  }
  const record = RecordSchema.safeParse(value)
  if (!record.success) return
  for (const [childKey, child] of Object.entries(record.data)) {
    collectMatchingText(child, childKey, queries, matches)
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
