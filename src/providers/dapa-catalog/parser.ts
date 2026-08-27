import {
  type DapaAdminRuleCatalogItem,
  DapaAdminRuleCatalogItemSchema,
  type DapaLawCatalogItem,
  DapaLawCatalogItemSchema,
} from "./schemas.js"

export type DapaAdminRulePage = {
  readonly totalCount: number
  readonly pageCount: number
  readonly items: readonly DapaAdminRuleCatalogItem[]
}

export function parseDapaLawPage(
  html: string,
  sourceUrl: string,
  retrievedAt = new Date().toISOString(),
): readonly DapaLawCatalogItem[] {
  const tables = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) ?? []
  const items: DapaLawCatalogItem[] = []
  for (const table of tables) {
    let category: DapaLawCatalogItem["category"] | undefined
    const rows = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []
    for (const row of rows) {
      const heading = cleanText(firstMatch(row, /<th\b[^>]*>([\s\S]*?)<\/th>/i))
      if (isLawCategory(heading)) category = heading
      if (category === undefined) continue
      const anchors = row.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? []
      for (const anchor of anchors) {
        const href = firstMatch(anchor, /\bhref=["']([^"']+)["']/i)
        const title = cleanText(firstMatch(anchor, /<a\b[^>]*>([\s\S]*?)<\/a>/i))
        if (href === undefined || title.length === 0 || /^javascript:/i.test(href)) continue
        const resolvedUrl = new URL(decodeEntities(href), sourceUrl).toString()
        const lawGoKrUrl = resolvedUrl.includes("law.go.kr") ? resolvedUrl : undefined
        const externalFileUrl = lawGoKrUrl === undefined ? resolvedUrl : undefined
        const item = DapaLawCatalogItemSchema.parse({
          id: `law:${encodeURIComponent(resolvedUrl)}`,
          kind: "law",
          category,
          title,
          sourceUrl,
          retrievedAt,
          ...(lawGoKrUrl === undefined ? {} : { lawGoKrUrl }),
          ...(externalFileUrl === undefined ? {} : { externalFileUrl }),
        })
        items.push(item)
      }
    }
  }
  return items
}

export function parseDapaAdminRulePage(
  html: string,
  sourceUrl: string,
  retrievedAt = new Date().toISOString(),
): DapaAdminRulePage {
  const totalCount = parseCount(firstMatch(html, /class=["']total-text["'][^>]*>([\s\S]*?)<\/p>/i))
  const pageText = cleanText(firstMatch(html, /class=["']page-text["'][^>]*>([\s\S]*?)<\/p>/i))
  const pageMatch = pageText.match(/(\d+)\s*\/\s*(\d+)/)
  const rows = html.match(/<tbody\b[^>]*>[\s\S]*?<\/tbody>/i)?.[0] ?? ""
  const items: DapaAdminRuleCatalogItem[] = []
  for (const row of rows.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (row.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(cleanText)
    if (cells.length < 6) continue
    const listNumber = Number.parseInt(cells[0] ?? "", 10)
    const registrationId = firstMatch(row, /RlmNttGList\(['"]([^'"]+)['"]\)/i)
    if (!Number.isInteger(listNumber) || registrationId === undefined) continue
    const category = parseAdminCategory(cells[4] ?? "")
    const promulgationDate = cells[5]
    if (category === undefined || promulgationDate === undefined) continue
    items.push(
      DapaAdminRuleCatalogItemSchema.parse({
        id: `admin-rule:${registrationId}`,
        kind: "admin_rule",
        category,
        title: cells[2] ?? "",
        listNumber,
        dapaRegistrationId: registrationId,
        promulgationNumber: cells[3] ?? "",
        promulgationDate,
        sourceUrl,
        retrievedAt,
      }),
    )
  }
  return {
    totalCount,
    pageCount: pageMatch === null ? 0 : Number.parseInt(pageMatch[2] ?? "0", 10),
    items,
  }
}

function parseAdminCategory(value: string): DapaAdminRuleCatalogItem["category"] | undefined {
  if (
    value === "훈령" ||
    value === "예규" ||
    value === "고시/공고" ||
    value === "매뉴얼" ||
    value === "기타/회계예규"
  ) {
    return value
  }
  return undefined
}

function isLawCategory(value: string): value is DapaLawCatalogItem["category"] {
  return value === "법령" || value === "시행령" || value === "시행규칙"
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  return pattern.exec(value)?.[1]
}

function cleanText(value: string | undefined): string {
  return decodeEntities(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x2F;/gi, "/")
}

function parseCount(value: string | undefined): number {
  const digits = cleanText(value).replace(/[^0-9]/g, "")
  return digits.length === 0 ? 0 : Number.parseInt(digits, 10)
}
