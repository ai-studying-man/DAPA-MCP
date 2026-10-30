import { z } from "zod"
import { DapaError } from "../../lib/errors/dapa-error.js"
import type { DapaSearchResult, SearchResponse } from "../../types/results.js"
import { waitForDeadline } from "../law/law-provider-response.js"
import { LawSearchCache } from "../law/law-search-cache.js"
import { sharedUpstreamGate } from "../law/upstream-gate.js"
import { courtBase, courtBytes } from "./http.js"
import {
  type CourtNotice,
  caseNumber,
  courtIdentifier,
  courtList,
  courtNotices,
  encodeCourtQuery,
} from "./parser.js"
import { courtPdf } from "./pdf.js"

type CourtRequest = { readonly forceRefresh?: boolean; readonly deadlineAt?: number }
type CourtSearchInput = CourtRequest & { readonly query: string; readonly limit?: number }
type CourtDetailInput = CourtRequest & { readonly documentId: string }
type CourtConfiguration = { readonly baseUrl?: string; readonly fileBaseUrl?: string }

export class OfficialCourtProvider {
  private readonly originals = new LawSearchCache<SearchResponse>(21_600_000)
  private readonly base: URL
  private readonly files: URL
  private readonly cache = new LawSearchCache<SearchResponse>(
    60_000,
    (response) => response.results.length === 0,
  )

  constructor(configuration: CourtConfiguration = {}) {
    this.base = courtBase(configuration.baseUrl ?? "https://www.scourt.go.kr", "www.scourt.go.kr")
    this.files = courtBase(
      configuration.fileBaseUrl ?? "https://file.scourt.go.kr",
      "file.scourt.go.kr",
    )
  }

  async search(input: CourtSearchInput): Promise<SearchResponse> {
    const query = z.string().trim().min(1).max(500).safeParse(input.query)
    if (!query.success) return failure(new DapaError("INVALID_ARGUMENT", "검색어를 확인하십시오"))
    const deadlineAt = input.deadlineAt ?? Date.now() + 15_000
    try {
      return await waitForDeadline(
        this.cache.getOrLoad(`search:${query.data}`, input.forceRefresh === true, async () => {
          const exactCase = caseNumber(query.data)
          const terms = exactCase
            ? [exactCase]
            : /지체상금|납기|납품지연/u.test(query.data)
              ? ["지연배상금", "지체상금"]
              : [query.data]
          const lists = await Promise.all(
            terms.map(async (term) => {
              const url = new URL(
                `/portal/news/NewsListAction.work?gubun=2&pageIndex=1&searchOption=&searchWord=${encodeCourtQuery(term)}`,
                this.base,
              )
              return courtList(await courtBytes(url, deadlineAt, 1_000_000), this.base)
            }),
          )
          const sequences = [...new Set(lists.flat())].slice(0, 3)
          for (const sequence of sequences) {
            const notices = await this.notice(sequence, deadlineAt)
            const chosen = notices.find(
              (notice) => exactCase === undefined || caseNumber(notice.downFile) === exactCase,
            )
            if (chosen) return this.original(chosen, deadlineAt, input.forceRefresh === true)
          }
          return { status: "NOT_FOUND", results: [], errors: [] }
        }),
        deadlineAt,
      )
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return failure(error)
    }
  }

  async getDetail(input: CourtDetailInput): Promise<SearchResponse> {
    try {
      const identifier = courtIdentifier(input.documentId)
      const deadlineAt = input.deadlineAt ?? Date.now() + 15_000
      return await waitForDeadline(
        this.cache.getOrLoad(input.documentId, input.forceRefresh === true, async () => {
          const notices = await this.notice(identifier.sequence, deadlineAt)
          const chosen = notices.find((notice) => notice.file === identifier.file)
          return chosen
            ? this.original(chosen, deadlineAt, input.forceRefresh === true)
            : { status: "NOT_FOUND", results: [], errors: [] }
        }),
        deadlineAt,
      )
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return failure(error)
    }
  }

  private async notice(sequence: string, deadlineAt: number): Promise<readonly CourtNotice[]> {
    const url = new URL(`/portal/news/NewsViewAction.work?gubun=2&seqnum=${sequence}`, this.base)
    return courtNotices(await courtBytes(url, deadlineAt, 1_000_000), sequence)
  }

  private async original(
    notice: CourtNotice,
    deadlineAt: number,
    forceRefresh: boolean,
  ): Promise<SearchResponse> {
    const gate = sharedUpstreamGate(`${this.files.origin}/court-pdf`, 2, 32)
    return waitForDeadline(
      this.originals.getOrLoad(`court:2:${notice.sequence}:${notice.file}`, forceRefresh, () =>
        gate.run(() => this.fetchOriginal(notice, deadlineAt), { deadlineAt }),
      ),
      deadlineAt,
    )
  }

  private async fetchOriginal(notice: CourtNotice, deadlineAt: number): Promise<SearchResponse> {
    const expectedCase = caseNumber(notice.downFile)
    if (expectedCase === undefined)
      throw new DapaError("SOURCE_UNAVAILABLE", "첨부파일 사건번호가 없습니다")
    const url = new URL("/AttachDownload", this.files)
    url.search = new URLSearchParams({
      file: notice.file,
      path: notice.path,
      downFile: notice.downFile,
    }).toString()
    const original = await courtPdf(
      await courtBytes(url, deadlineAt, 8_000_000),
      expectedCase,
      deadlineAt,
    )
    const sourceUrl = new URL(
      `/portal/news/NewsViewAction.work?gubun=2&seqnum=${notice.sequence}`,
      this.base,
    ).toString()
    const documentId = `court:2:${notice.sequence}:${notice.file}`
    const result: DapaSearchResult = {
      id: documentId,
      documentId,
      source: "대한민국 법원 공개 판결문",
      sourceType: "precedent",
      title: notice.title,
      summary: original.caseNumber,
      ...(original.organization === undefined ? {} : { organization: original.organization }),
      status: "unknown",
      verified: true,
      sourceUrl,
      retrievedAt: new Date().toISOString(),
      ...(original.date === undefined ? {} : { date: original.date }),
      content: JSON.stringify({
        판례내용: original.text,
        사건번호: original.caseNumber,
        sourceUrl,
        attachmentUrl: url.toString(),
        sha256: original.sha256,
        pageCount: original.pageCount,
        truncated: original.truncated,
        originalCharacters: original.originalCharacters,
        partyContext: "not_verified",
      }),
    }
    return {
      status: original.truncated ? "PARTIAL_RESULT" : "OK",
      results: [result],
      errors: original.truncated
        ? [{ code: "TRUNCATED", message: "법원 원문 반환 한도를 초과하여 본문 일부만 반환합니다" }]
        : [],
    }
  }
}

function failure(error: Error): SearchResponse {
  return {
    status: "SOURCE_UNAVAILABLE",
    results: [],
    errors: [
      {
        code: error instanceof DapaError ? error.code : "SOURCE_UNAVAILABLE",
        message: error.message,
      },
    ],
  }
}
