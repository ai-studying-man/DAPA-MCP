import { z } from "zod"
import { DapaError } from "../../lib/errors/dapa-error.js"

const ApiResponseSchema = z.record(z.string(), z.unknown())

export function sanitizeApiData(value: unknown): Readonly<Record<string, unknown>> {
  const sanitized = sanitizeValue(value)
  const parsed = ApiResponseSchema.safeParse(sanitized)
  if (!parsed.success) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API 응답 구조가 예상 형식과 다릅니다")
  }
  return parsed.data
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizeValue(child)]),
    )
  }
  return typeof value === "string" ? sanitizeUrlString(value) : value
}

export function sanitizeUrlString(value: string): string {
  return value
    .replace(/([?&])(?:O|%4F)(?:C|%43)=[^&#\s"'<>]*/gi, "")
    .replace(/(?:%26|&)(?:O|%4F)(?:C|%43)(?:%3D|=)[^%&#\s"'<>]*/gi, "")
    .replaceAll("?&", "?")
    .replaceAll("&&", "&")
    .replace(/[?&](?=$|[\s"'<>])/g, "")
}

export function removeOcSearchParams(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    if (key.toUpperCase() === "OC") url.searchParams.delete(key)
  }
}
