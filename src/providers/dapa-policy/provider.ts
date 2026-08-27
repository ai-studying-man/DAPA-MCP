import { readFile } from "node:fs/promises"
import { normalizeSearchText, similarityScore } from "../../lib/normalization/text.js"
import type { DapaSearchResult, ResponseStatus, SearchResponse } from "../../types/results.js"
import { type DapaPolicyFile, DapaPolicyFileSchema, type DapaPolicyPage } from "./schemas.js"

export type DapaPolicySearchInput = {
  readonly query: string
  readonly section?: string
  readonly limit?: number
}

export type DapaPolicyStatus = {
  readonly state: "healthy" | "unavailable"
  readonly totalCount: number
  readonly generatedAt?: string
  readonly error?: string
}

export interface DapaPolicyProvider {
  search(input: DapaPolicySearchInput): SearchResponse
  get(id: string): DapaPolicyPage | undefined
  status(): DapaPolicyStatus
}

class FileDapaPolicyProvider implements DapaPolicyProvider {
  constructor(
    private readonly catalog: DapaPolicyFile | undefined,
    private readonly loadError: string | undefined,
  ) {}

  search(input: DapaPolicySearchInput): SearchResponse {
    if (this.catalog === undefined)
      return unavailable(this.loadError ?? "업무·정책 자료가 없습니다")
    const query = normalizeSearchText(input.query)
    const results = this.catalog.pages
      .filter((page) => input.section === undefined || page.section === input.section)
      .map((page) => ({ page, score: scorePage(query, page) }))
      .filter(({ score }) => score >= 0.55)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit ?? 10)
      .map(({ page }) => toSearchResult(page, query))
    return { status: results.length > 0 ? "OK" : "NOT_FOUND", results, errors: [] }
  }

  get(id: string): DapaPolicyPage | undefined {
    return this.catalog?.pages.find((page) => page.id === id)
  }

  status(): DapaPolicyStatus {
    if (this.catalog === undefined) {
      return {
        state: "unavailable",
        totalCount: 0,
        ...(this.loadError === undefined ? {} : { error: this.loadError }),
      }
    }
    return {
      state: "healthy",
      totalCount: this.catalog.pages.length,
      generatedAt: this.catalog.generatedAt,
    }
  }
}

export async function loadDapaPolicyProvider(path: string): Promise<DapaPolicyProvider> {
  try {
    const text = await readFile(path, "utf8")
    return new FileDapaPolicyProvider(DapaPolicyFileSchema.parse(JSON.parse(text)), undefined)
  } catch (error) {
    const message = error instanceof Error ? error.message : "업무·정책 스냅샷을 읽을 수 없습니다"
    return new FileDapaPolicyProvider(undefined, message)
  }
}

function scorePage(query: string, page: DapaPolicyPage): number {
  const title = normalizeSearchText(page.title)
  const section = normalizeSearchText(page.section)
  const content = normalizeSearchText(page.content)
  if (title === query) return 1
  if (title.includes(query) || query.includes(title)) return 0.95
  if (
    section.includes(query) ||
    page.breadcrumbs.some((value) => normalizeSearchText(value).includes(query))
  ) {
    return 0.9
  }
  if (content.includes(query)) return 0.85
  return similarityScore(query, title)
}

function toSearchResult(page: DapaPolicyPage, query: string): DapaSearchResult {
  return {
    id: page.id,
    source: "DAPA_info",
    sourceType: "dapa_info",
    title: page.title,
    summary: excerpt(page.content, query),
    status: "current",
    verified: true,
    sourceUrl: page.sourceUrl,
    retrievedAt: page.retrievedAt,
    documentId: page.id,
  }
}

function excerpt(content: string, query: string): string {
  const normalizedContent = normalizeSearchText(content)
  const index = normalizedContent.indexOf(query)
  if (index < 0) return content.slice(0, 300)
  const start = Math.max(0, index - 100)
  return content.slice(start, start + 300)
}

function unavailable(message: string): SearchResponse {
  const status: ResponseStatus = "SOURCE_UNAVAILABLE"
  return { status, results: [], errors: [{ code: status, message }] }
}
