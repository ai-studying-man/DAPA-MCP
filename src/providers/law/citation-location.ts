import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { LegalArticle, LegalDocumentDetail } from "../../types/results.js"

export function citationLocationExists(article: LegalArticle, citation: string): boolean {
  const paragraph = citation.match(/제(\d+)항/u)?.[1]
  const item = citation.match(/제(\d+)호/u)?.[1]
  let text = article.text
  if (paragraph !== undefined) {
    const number = Number(paragraph)
    if (number < 1 || number > 20) return false
    const marker = String.fromCodePoint(0x2460 + number - 1)
    const start = text.indexOf(marker)
    if (start < 0) return false
    text = text.slice(start + marker.length).split(/[①-⑳]/u)[0] ?? ""
  }
  return item === undefined || new RegExp(`(?:^|\\n)\\s*${item}\\.\\s`, "u").test(text)
}

export function articleIdentity(article: LegalArticle): string {
  return article.articleNumber + (article.branch === undefined ? "" : `의${article.branch}`)
}

export function requestedArticles(queries: readonly string[]): readonly string[] {
  return queries.flatMap((query) =>
    [...query.matchAll(/제\s*(\d+)\s*조(?:의\s*(\d+))?/gu)].map(
      (match) => match[1] + (match[2] === undefined ? "" : `의${match[2]}`),
    ),
  )
}

export function requestedDocumentTitle(query: string): string | undefined {
  return /^(.+?(?:법|시행령|시행규칙|규정|지침))(?:\s*제\s*\d+\s*조|에서)/u.exec(query)?.[1]?.trim()
}

export function selectRequestedDetail(
  detail: LegalDocumentDetail,
  queries: readonly string[],
): LegalDocumentDetail | undefined {
  const title = queries.map(requestedDocumentTitle).find((value) => value !== undefined)
  if (
    title !== undefined &&
    detail.basicInfo.title !== undefined &&
    normalizeSearchText(title) !== normalizeSearchText(detail.basicInfo.title)
  )
    return undefined
  const requested = requestedArticles(queries)
  const articles = detail.articles.filter((article) => requested.includes(articleIdentity(article)))
  return articles.length === 0
    ? undefined
    : {
        basicInfo: detail.basicInfo,
        ...(detail.lawKey === undefined ? {} : { lawKey: detail.lawKey }),
        articles,
        supplementaryProvisions: [],
        annexes: [],
        forms: [],
      }
}
