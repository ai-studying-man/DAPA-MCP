import { z } from "zod"
import { DapaError } from "../../lib/errors/dapa-error.js"
import type { DapaSearchResult, LegalDocumentDetail } from "../../types/results.js"
import { sanitizeApiData } from "./law-api-sanitize.js"
import { parseLegalDocumentDetail } from "./legal-document.js"
import type { LawTargetConfig } from "./target-config.js"

const DetailSchema = z.record(z.string(), z.unknown())

export function parseLawDetailResponse(
  text: string,
  documentId: string,
  config: LawTargetConfig,
  retrievedAt: string,
): DapaSearchResult {
  return parseLawDetailDocument(text, documentId, config, retrievedAt).result
}

export type ParsedLawDetail = {
  readonly result: DapaSearchResult
  readonly detail: LegalDocumentDetail
}

export function parseLawDetailDocument(
  text: string,
  documentId: string,
  config: LawTargetConfig,
  retrievedAt: string,
): ParsedLawDetail {
  if (/^\s*</.test(text)) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API가 상세 JSON 대신 HTML/XML을 반환했습니다")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 상세 JSON 응답을 파싱할 수 없습니다", {
      cause: error,
    })
  }
  const detail = DetailSchema.safeParse(sanitizeApiData(parsed))
  if (!detail.success || Object.keys(detail.data).length === 0) {
    throw new DapaError(
      "SOURCE_UNAVAILABLE",
      "법제처 API가 빈 상세 응답을 반환해 부존재 여부를 확인할 수 없습니다",
    )
  }
  const title = findString(detail.data, [
    ...config.titleKeys,
    "법령명_한글",
    "법령명한글",
    "행정규칙명",
    "사건명",
    "안건명",
  ])
  if (title === undefined) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 상세 응답에서 문서 제목을 확인할 수 없습니다")
  }
  const lawRoot = DetailSchema.safeParse(detail.data["법령"])
  const administrativeRuleRoot = DetailSchema.safeParse(detail.data["행정규칙"])
  const administrativeRuleService = DetailSchema.safeParse(detail.data["AdmRulService"])
  const localOrdinanceService = DetailSchema.safeParse(detail.data["LawService"])
  const normalizedAdministrativeRule = administrativeRuleService.success
    ? normalizeAdministrativeRule(administrativeRuleService.data)
    : undefined
  const normalizedLocalOrdinance = localOrdinanceService.success
    ? normalizeLocalOrdinance(localOrdinanceService.data)
    : undefined
  const normalized = parseLegalDocumentDetail(
    lawRoot.success
      ? lawRoot.data
      : administrativeRuleRoot.success
        ? administrativeRuleRoot.data
        : (normalizedAdministrativeRule ?? normalizedLocalOrdinance ?? detail.data),
  )
  if (!hasSubstantiveContent(normalized, detail.data)) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 상세 응답에 법령 본문이 없습니다")
  }
  const effectiveDate =
    normalized.basicInfo.effectiveDate ?? formatDate(findString(detail.data, ["시행일자"]))
  const result: DapaSearchResult = {
    id: documentId,
    source: "국가법령정보 공동활용 Open API",
    sourceType: config.sourceType,
    title,
    content: JSON.stringify(detail.data),
    ...(effectiveDate === undefined ? {} : { effectiveDate }),
    status: config.sourceType === "law" ? "current" : "unknown",
    verified: true,
    sourceUrl: "https://www.law.go.kr",
    retrievedAt,
    documentId,
  }
  return { result, detail: normalized }
}

function normalizeLocalOrdinance(root: Record<string, unknown>): Record<string, unknown> {
  const basicInfo = DetailSchema.safeParse(root["자치법규기본정보"])
  const info = basicInfo.success ? basicInfo.data : {}
  const articlesRoot = DetailSchema.safeParse(root["조문"])
  const articles = articlesRoot.success
    ? normalizeLocalOrdinanceArticles(articlesRoot.data["조"])
    : []
  return {
    ...root,
    기본정보: {
      법령명_한글: info["자치법규명"],
      법령ID: info["자치법규ID"] ?? info["자치법규일련번호"],
      공포일자: info["공포일자"],
      시행일자: info["시행일자"],
      소관부처: info["지자체기관명"],
      법종구분: info["자치법규종류"],
      제개정구분: info["제개정정보"],
    },
    조문: { 조문단위: articles },
  }
}

function normalizeLocalOrdinanceArticles(value: unknown): readonly Record<string, unknown>[] {
  const candidates = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return candidates.flatMap((candidate) => {
    const article = DetailSchema.safeParse(candidate)
    if (!article.success) return []
    const text = article.data["조내용"]
    const bodyNumber =
      typeof text === "string" ? /^제(\d+(?:의\d+)?)조/u.exec(text)?.[1] : undefined
    const rawNumber = article.data["조문번호"]
    const articleNumber =
      bodyNumber ??
      (typeof rawNumber === "string" || typeof rawNumber === "number"
        ? String(rawNumber)
        : undefined)
    if (articleNumber === undefined) return []
    return [
      {
        조문번호: articleNumber,
        조문제목: article.data["조제목"],
        조문내용: article.data["조내용"],
      },
    ]
  })
}

function hasSubstantiveContent(
  detail: LegalDocumentDetail,
  raw: Readonly<Record<string, unknown>>,
): boolean {
  if (
    detail.articles.length > 0 ||
    detail.supplementaryProvisions.length > 0 ||
    detail.annexes.length > 0 ||
    detail.forms.length > 0 ||
    detail.amendmentText !== undefined ||
    detail.amendmentReason !== undefined
  ) {
    return true
  }
  return containsSubstantiveField(raw)
}

function containsSubstantiveField(value: unknown, keyName = ""): boolean {
  if (Array.isArray(value)) return value.some((child) => containsSubstantiveField(child, keyName))
  const record = DetailSchema.safeParse(value)
  if (record.success) {
    return Object.entries(record.data).some(([key, child]) => containsSubstantiveField(child, key))
  }
  if (!/(내용|요지|회답|주문|이유|판결|결정|처분)/u.test(keyName)) return false
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().length > 0
    : value !== null && value !== undefined
}

function normalizeAdministrativeRule(root: Record<string, unknown>): Record<string, unknown> {
  const basicInfo = DetailSchema.safeParse(root["행정규칙기본정보"])
  const info = basicInfo.success ? basicInfo.data : {}
  return {
    ...root,
    기본정보: {
      법령명_한글: info["행정규칙명"],
      법령ID: info["행정규칙ID"] ?? info["행정규칙일련번호"],
      공포일자: info["발령일자"],
      시행일자: info["시행일자"],
      소관부처: info["소관부처명"],
      법종구분: info["행정규칙종류"],
    },
    조문: { 조문단위: normalizeAdministrativeArticles(root["조문내용"]) },
  }
}

function normalizeAdministrativeArticles(value: unknown): readonly Record<string, string>[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== "string") return []
    const match = /^제(\d+)(?:의(\d+))?조(?:\(([^)]*)\))?/.exec(item.trim())
    if (match === null) return []
    const majorNumber = match[1]
    if (majorNumber === undefined) return []
    const articleNumber = match[2] === undefined ? majorNumber : `${majorNumber}의${match[2]}`
    return [
      {
        조문번호: articleNumber,
        ...(match[3] === undefined ? {} : { 조문제목: match[3] }),
        조문내용: item.trim(),
      },
    ]
  })
}

function findString(value: unknown, keys: readonly string[]): string | undefined {
  const record = DetailSchema.safeParse(value)
  if (record.success) {
    for (const key of keys) {
      const candidate = record.data[key]
      if (typeof candidate === "string" || typeof candidate === "number") return String(candidate)
    }
    for (const nested of Object.values(record.data)) {
      const found = findString(nested, keys)
      if (found !== undefined) return found
    }
  }
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = findString(nested, keys)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function formatDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const digits = value.replace(/[^0-9]/g, "")
  if (!/^\d{8}$/.test(digits)) return value
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}
