import type { LegalArticle } from "../../types/results.js"

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
