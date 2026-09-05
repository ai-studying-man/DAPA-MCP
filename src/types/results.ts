export const SOURCE_TYPES = [
  "law",
  "administrative_rule",
  "local_ordinance",
  "precedent",
  "constitutional_case",
  "interpretation",
  "administrative_appeal",
  "committee_decision",
  "dapa_info",
] as const

export type SourceType = (typeof SOURCE_TYPES)[number]

export const DOCUMENT_STATUSES = [
  "current",
  "historical",
  "amended",
  "repealed",
  "unknown",
] as const

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export type DapaSearchResult = {
  readonly id: string
  readonly source: string
  readonly sourceType: SourceType
  readonly title: string
  readonly summary?: string
  readonly content?: string
  readonly organization?: string
  readonly date?: string
  readonly effectiveDate?: string
  readonly status: DocumentStatus
  readonly verified: boolean
  readonly sourceUrl?: string
  readonly retrievedAt: string
  readonly documentId: string
}

export type LegalArticle = {
  readonly articleNumber: string
  readonly branch?: string
  readonly title?: string
  readonly effectiveDate?: string
  readonly text: string
}

export type LegalSupplementaryProvision = {
  readonly promulgationDate?: string
  readonly promulgationNumber?: string
  readonly text: string
}

export type LegalAttachment = {
  readonly name?: string
  readonly text: string
}

export type LegalDocumentDetail = {
  readonly lawKey?: string
  readonly basicInfo: {
    readonly title?: string
    readonly lawId?: string
    readonly documentType?: string
    readonly organization?: string
    readonly promulgationDate?: string
    readonly effectiveDate?: string
    readonly amendmentType?: string
  }
  readonly articles: readonly LegalArticle[]
  readonly supplementaryProvisions: readonly LegalSupplementaryProvision[]
  readonly annexes: readonly LegalAttachment[]
  readonly forms: readonly LegalAttachment[]
  readonly amendmentText?: string
  readonly amendmentReason?: string
}

export type LegalHistoryVersion = {
  readonly documentId: string
  readonly title: string
  readonly effectiveDate?: string
  readonly promulgationDate?: string
  readonly promulgationNumber?: string
  readonly amendmentType?: string
  readonly sourceUrl?: string
}

export type LegalHistoryResponse = {
  readonly status: ResponseStatus
  readonly lawName: string
  readonly totalCount: number
  readonly versions: readonly LegalHistoryVersion[]
  readonly errors: readonly {
    readonly code: string
    readonly message: string
  }[]
}

export const RESPONSE_STATUSES = [
  "OK",
  "NOT_FOUND",
  "PARTIAL_RESULT",
  "SOURCE_UNAVAILABLE",
] as const

export type ResponseStatus = (typeof RESPONSE_STATUSES)[number]

export type SearchResponse = {
  readonly status: ResponseStatus
  readonly results: readonly DapaSearchResult[]
  readonly errors: readonly {
    readonly code: string
    readonly message: string
  }[]
  readonly detail?: LegalDocumentDetail
}
