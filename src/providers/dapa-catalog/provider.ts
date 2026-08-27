import { readFile } from "node:fs/promises"
import { normalizeSearchText, similarityScore } from "../../lib/normalization/text.js"
import type { ResponseStatus } from "../../types/results.js"
import { type DapaCatalogFile, DapaCatalogFileSchema, type DapaCatalogItem } from "./schemas.js"

export type DapaCatalogSearchInput = {
  readonly query: string
  readonly kind?: DapaCatalogItem["kind"]
  readonly category?: string
  readonly limit?: number
}

export type DapaCatalogSearchResponse = {
  readonly status: ResponseStatus
  readonly results: readonly DapaCatalogItem[]
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export type DapaCatalogStatus = {
  readonly state: "healthy" | "unavailable"
  readonly totalCount: number
  readonly lawCount: number
  readonly adminRuleCount: number
  readonly pageCount: number
  readonly generatedAt?: string
  readonly error?: string
}

export interface DapaCatalogProvider {
  search(input: DapaCatalogSearchInput): DapaCatalogSearchResponse
  get(id: string): DapaCatalogItem | undefined
  status(): DapaCatalogStatus
}

class FileDapaCatalogProvider implements DapaCatalogProvider {
  constructor(
    private readonly catalog: DapaCatalogFile | undefined,
    private readonly loadError: string | undefined,
  ) {}

  search(input: DapaCatalogSearchInput): DapaCatalogSearchResponse {
    if (this.catalog === undefined)
      return unavailable(this.loadError ?? "DAPA 카탈로그를 사용할 수 없습니다")
    const query = normalizeSearchText(input.query)
    const scored = this.catalog.items
      .filter((item) => input.kind === undefined || item.kind === input.kind)
      .filter((item) => input.category === undefined || item.category === input.category)
      .map((item) => ({ item, score: scoreItem(query, item) }))
      .filter(({ score }) => score >= 0.55)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit ?? 10)
      .map(({ item }) => item)
    return { status: scored.length > 0 ? "OK" : "NOT_FOUND", results: scored, errors: [] }
  }

  get(id: string): DapaCatalogItem | undefined {
    return this.catalog?.items.find((item) => item.id === id)
  }

  status(): DapaCatalogStatus {
    if (this.catalog === undefined) {
      return {
        state: "unavailable",
        totalCount: 0,
        lawCount: 0,
        adminRuleCount: 0,
        pageCount: 0,
        ...(this.loadError === undefined ? {} : { error: this.loadError }),
      }
    }
    const lawCount = this.catalog.items.filter((item) => item.kind === "law").length
    return {
      state: "healthy",
      totalCount: this.catalog.items.length,
      lawCount,
      adminRuleCount: this.catalog.items.length - lawCount,
      pageCount: this.catalog.pageCount,
      generatedAt: this.catalog.generatedAt,
    }
  }
}

export async function loadDapaCatalogProvider(path: string): Promise<DapaCatalogProvider> {
  try {
    const text = await readFile(path, "utf8")
    return new FileDapaCatalogProvider(DapaCatalogFileSchema.parse(JSON.parse(text)), undefined)
  } catch (error) {
    const message = error instanceof Error ? error.message : "DAPA 카탈로그 파일을 읽을 수 없습니다"
    return new FileDapaCatalogProvider(undefined, message)
  }
}

function scoreItem(query: string, item: DapaCatalogItem): number {
  const title = normalizeSearchText(item.title)
  if (title === query) return 1
  if (title.includes(query) || query.includes(title)) return 0.9
  return similarityScore(query, title)
}

function unavailable(message: string): DapaCatalogSearchResponse {
  return {
    status: "SOURCE_UNAVAILABLE",
    results: [],
    errors: [{ code: "SOURCE_UNAVAILABLE", message }],
  }
}
