import { DapaError } from "../../lib/errors/dapa-error.js"
import type { LegalHistoryVersion } from "../../types/results.js"

const ROW_PATTERN = /<tr[^>]*>[\s\S]*?<\/tr>/gi

export type ParsedHistory = {
  readonly totalCount: number
  readonly versions: readonly LegalHistoryVersion[]
}

export function parseLawHistoryResponse(
  html: string,
  lawName: string,
  limit: number,
): ParsedHistory {
  if (!/<html[\s>]/i.test(html) && !/<tr[\s>]/i.test(html)) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 연혁 응답이 HTML 형식이 아닙니다")
  }
  const expected = normalize(lawName)
  const versions = html.match(ROW_PATTERN)?.flatMap((row) => parseRow(row, expected)) ?? []
  const unique = [
    ...new Map(
      versions.map((item) => [`${item.documentId}:${item.effectiveDate ?? ""}`, item]),
    ).values(),
  ]
  unique.sort((left, right) => (right.effectiveDate ?? "").localeCompare(left.effectiveDate ?? ""))
  return {
    totalCount: parseTotalCount(html),
    versions: unique.slice(0, limit),
  }
}

function parseRow(row: string, expected: string): readonly LegalHistoryVersion[] {
  const link = row.match(/MST=(\d+)[^"']*?(?:&amp;|&)efYd=(\d*)/i)
  const title = row.match(/<a[^>]*>([^<]+)<\/a>/i)?.[1]?.trim()
  if (link === null || title === undefined || normalize(title) !== expected) return []
  const documentId = link[1]
  const rawEffectiveDate = link[2]
  if (documentId === undefined || rawEffectiveDate === undefined) return []
  const dates = [...row.matchAll(/(20\d{2})[.-](\d{1,2})[.-](\d{1,2})/g)]
    .map((match) => {
      const year = match[1]
      const month = match[2]
      const day = match[3]
      return year === undefined || month === undefined || day === undefined
        ? undefined
        : `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    })
    .filter((date): date is string => date !== undefined)
  const effectiveDate = formatDate(rawEffectiveDate)
  const promulgationNumber = row.match(/제\s*(\d+)\s*호/)?.[1]
  const amendmentType = row.match(
    /(폐지제정|제정|일부개정|전부개정|타법개정|타법폐지|일괄개정|일괄폐지|폐지)/,
  )?.[1]
  return [
    {
      documentId,
      title,
      ...(effectiveDate === undefined ? {} : { effectiveDate }),
      ...(dates[0] === undefined ? {} : { promulgationDate: dates[0] }),
      ...(promulgationNumber === undefined ? {} : { promulgationNumber }),
      ...(amendmentType === undefined ? {} : { amendmentType }),
    } satisfies LegalHistoryVersion,
  ]
}

function parseTotalCount(html: string): number {
  const count = html.match(/<strong[^>]*>([\d,]+)<\/strong>\s*건/i)?.[1]
  return count === undefined ? 0 : Number(count.replace(/,/g, ""))
}

function normalize(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, "")
    .replace(/\s/g, "")
}

function formatDate(value: string): string | undefined {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : undefined
}
