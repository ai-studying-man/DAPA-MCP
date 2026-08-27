import { z } from "zod"
import type {
  LegalArticle,
  LegalAttachment,
  LegalDocumentDetail,
  LegalSupplementaryProvision,
} from "../../types/results.js"

const RecordSchema = z.record(z.string(), z.unknown())

export function parseLegalDocumentDetail(root: Record<string, unknown>): LegalDocumentDetail {
  const basicInfo = asRecord(root["기본정보"]) ?? {}
  const articlesRoot = asRecord(root["조문"]) ?? {}
  const supplementaryRoot = asRecord(root["부칙"]) ?? {}
  const lawKey = stringValue(root["법령키"])
  const title = stringValue(basicInfo["법령명_한글"])
  const lawId = stringValue(basicInfo["법령ID"])
  const documentType = nestedContent(basicInfo["법종구분"])
  const organization = nestedContent(basicInfo["소관부처"])
  const promulgationDate = formatDate(stringValue(basicInfo["공포일자"]))
  const effectiveDate = formatDate(stringValue(basicInfo["시행일자"]))
  const amendmentType = stringValue(basicInfo["제개정구분"])
  const amendmentText = textByKey(root, "개정문내용")
  const amendmentReason = textByKey(root, "제개정이유내용")
  return {
    ...(lawKey === undefined ? {} : { lawKey }),
    basicInfo: {
      ...(title === undefined ? {} : { title }),
      ...(lawId === undefined ? {} : { lawId }),
      ...(documentType === undefined ? {} : { documentType }),
      ...(organization === undefined ? {} : { organization }),
      ...(promulgationDate === undefined ? {} : { promulgationDate }),
      ...(effectiveDate === undefined ? {} : { effectiveDate }),
      ...(amendmentType === undefined ? {} : { amendmentType }),
    },
    articles: parseArticles(articlesRoot["조문단위"]),
    supplementaryProvisions: parseSupplementary(supplementaryRoot["부칙단위"]),
    annexes: collectAttachments(root, "별표"),
    forms: collectAttachments(root, "서식"),
    ...(amendmentText === undefined ? {} : { amendmentText }),
    ...(amendmentReason === undefined ? {} : { amendmentReason }),
  }
}

function parseArticles(value: unknown): readonly LegalArticle[] {
  return records(value).flatMap((item) => {
    const articleNumber = stringValue(item["조문번호"])
    if (articleNumber === undefined) return []
    const text = [textByKey(item, "조문내용"), textByKey(item, "항")]
      .filter((part): part is string => part !== undefined)
      .join("\n")
    const branch = stringValue(item["조문가지번호"])
    const title = stringValue(item["조문제목"])
    const effectiveDate = formatDate(stringValue(item["조문시행일자"]))
    return [
      {
        articleNumber,
        ...(branch === undefined ? {} : { branch }),
        ...(title === undefined ? {} : { title }),
        ...(effectiveDate === undefined ? {} : { effectiveDate }),
        text,
      } satisfies LegalArticle,
    ]
  })
}

function parseSupplementary(value: unknown): readonly LegalSupplementaryProvision[] {
  return records(value).map((item) => {
    const promulgationDate = formatDate(stringValue(item["부칙공포일자"]))
    const promulgationNumber = stringValue(item["부칙공포번호"])
    return {
      ...(promulgationDate === undefined ? {} : { promulgationDate }),
      ...(promulgationNumber === undefined ? {} : { promulgationNumber }),
      text: textByKey(item, "부칙내용") ?? "",
    }
  })
}

function collectAttachments(root: unknown, keyFragment: string): readonly LegalAttachment[] {
  const found: LegalAttachment[] = []
  const visit = (value: unknown): void => {
    const record = asRecord(value)
    if (record !== undefined) {
      for (const [key, child] of Object.entries(record)) {
        if (key.includes(keyFragment)) {
          for (const item of records(child)) {
            const name = stringValue(item["별표명"] ?? item["서식명"])
            found.push({
              ...(name === undefined ? {} : { name }),
              text: textByKey(item, "내용") ?? textByKey(item, key) ?? "",
            })
          }
        }
        visit(child)
      }
    } else if (Array.isArray(value)) {
      for (const child of value) visit(child)
    }
  }
  visit(root)
  return found
}

function records(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => records(item))
  const record = asRecord(value)
  return record === undefined ? [] : [record]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = RecordSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function textByKey(value: unknown, key: string): string | undefined {
  const record = asRecord(value)
  if (record !== undefined) {
    const direct = record[key]
    if (direct !== undefined) {
      const text = flattenText(direct)
      if (text !== "") return text
    }
    return Object.values(record)
      .map((child) => textByKey(child, key))
      .find((text): text is string => text !== undefined)
  }
  if (Array.isArray(value)) {
    return value
      .map((child) => textByKey(child, key))
      .find((text): text is string => text !== undefined)
  }
  return undefined
}

function flattenText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim()
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join("\n")
  const record = asRecord(value)
  if (record === undefined) return ""
  return Object.entries(record)
    .filter(([key]) => key.endsWith("내용") || key === "content")
    .map(([, child]) => flattenText(child))
    .filter(Boolean)
    .join("\n")
}

function nestedContent(value: unknown): string | undefined {
  const record = asRecord(value)
  return record === undefined ? stringValue(value) : stringValue(record["content"])
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined
}

function formatDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const digits = value.replace(/[^0-9]/g, "")
  return /^\d{8}$/.test(digits)
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : value
}
