import { z } from "zod"
import { DapaError } from "../../lib/errors/dapa-error.js"
import type { ResponseStatus } from "../../types/results.js"
import type { LawApiConfig } from "./law-api-catalog.js"
import { sanitizeApiData } from "./law-api-sanitize.js"

const ApiResponseSchema = z.record(z.string(), z.unknown())
const AuthenticationFailureSchema = z.object({
  result: z.string(),
  msg: z.string().optional(),
})
const SUCCESS_RESULT_CODES = new Set(["0", "00", "200", "success"])
const AUTHENTICATION_ERROR = /사용자(?: 정보)? 검증|인증|unauthori[sz]ed/i
const FAILURE_RESULT = /실패|오류|error|invalid/i
const NO_RESULT_MESSAGE =
  /^(?:일치하는 .*없습니다|검색결과가? 없습니다|검색조건을 확인하여 주십시오)/u
const DETAIL_METADATA_FIELDS = new Set([
  "resultCode",
  "resultMsg",
  "target",
  "키워드",
  "section",
  "page",
  "numOfRows",
  "totalCnt",
])

export type ParsedLawApiResponse = {
  readonly data: Readonly<Record<string, unknown>>
  readonly status: ResponseStatus
}

export function parseLawApiResponse(text: string, api: LawApiConfig): ParsedLawApiResponse {
  if (/^\s*</.test(text)) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API가 JSON 대신 HTML/XML을 반환했습니다")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API JSON 응답을 파싱할 수 없습니다", {
      cause: error,
    })
  }
  const response = ApiResponseSchema.safeParse(parsed)
  if (!response.success) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API 응답 구조가 예상 형식과 다릅니다")
  }
  const data = sanitizeApiData(response.data)
  throwForOfficialError(data)
  return { data, status: isEmptyApiResponse(api, data) ? "NOT_FOUND" : "OK" }
}

function throwForOfficialError(data: Readonly<Record<string, unknown>>): void {
  const authenticationFailure = AuthenticationFailureSchema.safeParse(data)
  if (authenticationFailure.success && FAILURE_RESULT.test(authenticationFailure.data.result)) {
    const message = [authenticationFailure.data.result, authenticationFailure.data.msg]
      .filter((part): part is string => part !== undefined)
      .join(" ")
    throw new DapaError(errorCodeFor(message), message)
  }

  visitRecords(data, (record) => {
    const codeValue = record["resultCode"]
    if (typeof codeValue !== "string" && typeof codeValue !== "number") return
    const code = String(codeValue).trim()
    if (SUCCESS_RESULT_CODES.has(code.toLowerCase())) return
    const messageValue = record["resultMsg"] ?? record["msg"]
    const detail = typeof messageValue === "string" ? ` ${messageValue}` : ""
    const message = `법제처 API 오류(resultCode=${code}).${detail}`.trim()
    throw new DapaError(errorCodeFor(message), message)
  })
}

function errorCodeFor(message: string): "AUTH_REQUIRED" | "SOURCE_UNAVAILABLE" {
  return AUTHENTICATION_ERROR.test(message) ? "AUTH_REQUIRED" : "SOURCE_UNAVAILABLE"
}

function isEmptyApiResponse(api: LawApiConfig, data: Readonly<Record<string, unknown>>): boolean {
  if (Object.keys(data).length === 0) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API 응답에 결과가 없습니다")
  }
  if (hasNoResultMessage(data)) return true
  if (api.operation === "list") {
    if (findTotalCount(data) === 0) return true
    if (!hasDetailContent(data)) {
      throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API 목록 응답에 결과 항목이 없습니다")
    }
    return false
  }
  if (api.operation === "detail" && !hasDetailContent(data)) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API 상세 응답에 본문이 없습니다")
  }
  return false
}

function hasNoResultMessage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasNoResultMessage)
  const record = ApiResponseSchema.safeParse(value)
  if (record.success) return Object.values(record.data).some(hasNoResultMessage)
  return typeof value === "string" && NO_RESULT_MESSAGE.test(value.trim())
}

function findTotalCount(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    return value.map(findTotalCount).find((count): count is number => count !== undefined)
  }
  const record = ApiResponseSchema.safeParse(value)
  if (!record.success) return undefined
  for (const [key, child] of Object.entries(record.data)) {
    if (key === "totalCnt" && (typeof child === "string" || typeof child === "number")) {
      const count = Number(child)
      if (Number.isFinite(count)) return count
    }
    const nested = findTotalCount(child)
    if (nested !== undefined) return nested
  }
  return undefined
}

function hasDetailContent(value: unknown, fieldName?: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasDetailContent(item))
  const record = ApiResponseSchema.safeParse(value)
  if (record.success) {
    return Object.entries(record.data).some(([key, child]) => hasDetailContent(child, key))
  }
  if (fieldName === undefined || DETAIL_METADATA_FIELDS.has(fieldName)) return false
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined
}

function visitRecords(
  value: unknown,
  visit: (record: Readonly<Record<string, unknown>>) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, visit)
    return
  }
  const record = ApiResponseSchema.safeParse(value)
  if (!record.success) return
  visit(record.data)
  for (const child of Object.values(record.data)) visitRecords(child, visit)
}
