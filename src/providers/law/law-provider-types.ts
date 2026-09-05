import type { SourceType } from "../../types/results.js"

export type LegalSearchInput = {
  readonly query: string
  readonly types?: readonly SourceType[]
  readonly currentOnly?: boolean
  readonly forceRefresh?: boolean
  readonly asOfDate?: string
  readonly organization?: string
  readonly limit?: number
  readonly page?: number
  readonly searchScope?: "title" | "content"
  readonly deadlineAt?: number
}

export type LawProviderConfig = {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly retryLimit?: number
  readonly cacheTtlMs?: number
  readonly detailCacheTtlMs?: number
  readonly maxTextResponseBytes?: number
  readonly maxResourceResponseBytes?: number
  readonly maxConcurrency?: number
  readonly maxQueue?: number
  readonly referer?: string
  readonly userAgent?: string
}

export type LegalDetailInput = {
  readonly documentId: string
  readonly sourceType: SourceType
  readonly forceRefresh?: boolean
  readonly deadlineAt?: number
}

export type ProviderHealth = "healthy" | "not_configured" | "unavailable"
