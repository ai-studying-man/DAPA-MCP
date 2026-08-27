import { type ParsedCitation, parseCitation } from "../../lib/citation/parser.js"
import { DapaError } from "../../lib/errors/dapa-error.js"
import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { DapaSearchResult, SearchResponse } from "../../types/results.js"
import type { LawProvider } from "./law-provider.js"

export const VERIFICATION_STATUSES = [
  "VERIFIED",
  "NOT_FOUND",
  "UNVERIFIED",
  "SOURCE_UNAVAILABLE",
  "AMBIGUOUS",
] as const

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export type CitationVerification = {
  readonly citation: string
  readonly status: VerificationStatus
  readonly sourceUrl?: string
  readonly documentId?: string
  readonly message: string
}

export class CitationVerifier {
  constructor(private readonly lawProvider: LawProvider) {}

  async verify(citations: readonly string[]): Promise<readonly CitationVerification[]> {
    return Promise.all(citations.map((citation) => this.verifyOne(parseCitation(citation))))
  }

  private async verifyOne(citation: ParsedCitation): Promise<CitationVerification> {
    switch (citation.kind) {
      case "unknown":
        return result(citation.raw, "UNVERIFIED", "지원하는 법령·판례 인용 형식이 아닙니다")
      case "case":
        return this.verifyCase(citation)
      case "law":
        return this.verifyLaw(citation)
      default:
        return assertNever(citation.kind)
    }
  }

  private async verifyLaw(citation: ParsedCitation): Promise<CitationVerification> {
    const search = await this.lawProvider.search({
      query: citation.documentName ?? citation.raw,
      types: ["law"],
      currentOnly: true,
      limit: 20,
    })
    const unavailableResult = fromUnavailableSearch(citation.raw, search)
    if (unavailableResult !== undefined) return unavailableResult
    const expectedName = normalizeSearchText(citation.documentName ?? "")
    const exact = search.results.filter((item) => normalizeSearchText(item.title) === expectedName)
    if (exact.length === 0)
      return result(citation.raw, "NOT_FOUND", "현행 법령명을 확인할 수 없습니다")
    if (exact.length > 1)
      return result(citation.raw, "AMBIGUOUS", "동일한 법령명 후보가 여러 건입니다")
    const document = exact[0]
    if (document === undefined) return result(citation.raw, "NOT_FOUND", "법령 후보가 없습니다")
    const detail = await this.lawProvider.getDetail({
      documentId: document.documentId,
      sourceType: "law",
    })
    if (detail.status !== "OK") {
      return result(
        citation.raw,
        "SOURCE_UNAVAILABLE",
        detail.errors[0]?.message ?? "상세 조회 실패",
      )
    }
    const content = detail.results[0]?.content ?? ""
    const articleNumber = citation.article?.match(/제(\d+)조/)?.[1]
    const articleFound =
      articleNumber !== undefined &&
      (content.includes(`"조문번호":"${articleNumber}"`) ||
        content.includes(`"조문번호":${articleNumber}`) ||
        normalizeSearchText(content).includes(normalizeSearchText(`제${articleNumber}조`)))
    if (!articleFound)
      return withDocument(citation.raw, "NOT_FOUND", "해당 조문을 확인할 수 없습니다", document)
    return withDocument(
      citation.raw,
      "VERIFIED",
      "법령명과 조문이 공식 본문에서 확인되었습니다",
      document,
    )
  }

  private async verifyCase(citation: ParsedCitation): Promise<CitationVerification> {
    const search = await this.lawProvider.search({
      query: citation.caseNumber ?? citation.raw,
      types: ["precedent"],
      limit: 20,
    })
    const unavailableResult = fromUnavailableSearch(citation.raw, search)
    if (unavailableResult !== undefined) return unavailableResult
    const exact = search.results.filter((item) => item.summary === citation.caseNumber)
    if (exact.length === 0)
      return result(citation.raw, "NOT_FOUND", "사건번호를 확인할 수 없습니다")
    if (exact.length > 1)
      return result(citation.raw, "AMBIGUOUS", "동일 사건번호 후보가 여러 건입니다")
    const document = exact[0]
    return document === undefined
      ? result(citation.raw, "NOT_FOUND", "판례 후보가 없습니다")
      : withDocument(
          citation.raw,
          "VERIFIED",
          "사건번호가 공식 판례 검색에서 확인되었습니다",
          document,
        )
  }
}

function fromUnavailableSearch(
  citation: string,
  search: SearchResponse,
): CitationVerification | undefined {
  if (search.status === "NOT_FOUND")
    return result(citation, "NOT_FOUND", "공식 검색 결과가 없습니다")
  if (search.status === "SOURCE_UNAVAILABLE") {
    return result(
      citation,
      "SOURCE_UNAVAILABLE",
      search.errors[0]?.message ?? "공식 출처 조회 실패",
    )
  }
  return undefined
}

function result(
  citation: string,
  status: VerificationStatus,
  message: string,
): CitationVerification {
  return { citation, status, message }
}

function withDocument(
  citation: string,
  status: VerificationStatus,
  message: string,
  document: DapaSearchResult,
): CitationVerification {
  return {
    citation,
    status,
    message,
    documentId: document.documentId,
    ...(document.sourceUrl === undefined ? {} : { sourceUrl: document.sourceUrl }),
  }
}

function assertNever(value: never): never {
  throw new DapaError("INTERNAL_ERROR", `처리되지 않은 인용 유형: ${String(value)}`)
}
