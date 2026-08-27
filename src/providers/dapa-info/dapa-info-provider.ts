import { readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { normalizeSearchText, similarityScore } from "../../lib/normalization/text.js"
import type { DapaSearchResult, SearchResponse } from "../../types/results.js"
import type { DapaCategory } from "./categories.js"
import { type DapaInfoEntry, DapaInfoFileSchema } from "./schemas.js"

const PROVIDER_OWNED_DIRECTORIES = new Set(["legal", "policy"])
const IGNORED_JSON_FILES = new Set([
  "aliases.json",
  "sources.json",
  "api-registry.json",
  "catalog.json",
])

export type { DapaCategory } from "./categories.js"
export { DAPA_CATEGORIES } from "./categories.js"

export type DapaInfoSearchInput = {
  readonly query: string
  readonly categories?: readonly DapaCategory[]
  readonly limit?: number
}

export interface DapaInfoProvider {
  search(input: DapaInfoSearchInput): SearchResponse
  getOrganization(query: string): DapaSearchResult | undefined
  health(): "healthy" | "unavailable"
}

class FileDapaInfoProvider implements DapaInfoProvider {
  constructor(
    private readonly entries: readonly DapaInfoEntry[],
    private readonly retrievedAt: string,
  ) {}

  search(input: DapaInfoSearchInput): SearchResponse {
    const query = normalizeSearchText(input.query)
    const limit = input.limit ?? 10
    const categorySet = input.categories === undefined ? undefined : new Set(input.categories)
    const scored = this.entries
      .filter((entry) => categorySet === undefined || categorySet.has(entry.category))
      .map((entry) => ({ entry, score: scoreEntry(query, entry) }))
      .filter(({ score }) => score >= 0.55)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ entry }) => this.toResult(entry))

    return {
      status: scored.length > 0 ? "OK" : "NOT_FOUND",
      results: scored,
      errors: [],
    }
  }

  getOrganization(query: string): DapaSearchResult | undefined {
    return this.search({ query, categories: ["organization"], limit: 1 }).results[0]
  }

  health(): "healthy" {
    return "healthy"
  }

  private toResult(entry: DapaInfoEntry): DapaSearchResult {
    const result = {
      id: entry.id,
      source: "DAPA_info",
      sourceType: "dapa_info",
      title: entry.name,
      summary: entry.description,
      status: "current",
      verified: entry.verified,
      sourceUrl: entry.sourceUrl,
      retrievedAt: this.retrievedAt,
      documentId: entry.id,
    } as const
    return entry.practicalMeaning === undefined
      ? result
      : { ...result, content: entry.practicalMeaning }
  }
}

function scoreEntry(query: string, entry: DapaInfoEntry): number {
  const names = [entry.name, ...entry.aliases, ...entry.relatedTerms]
  const normalizedNames = names.map(normalizeSearchText)
  if (normalizedNames.some((value) => value === query)) return 1
  if (normalizedNames.some((value) => value.includes(query) || query.includes(value))) return 0.9
  return Math.max(...normalizedNames.map((value) => similarityScore(query, value)), 0)
}

async function listJsonFiles(rootPath: string): Promise<readonly string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = join(rootPath, entry.name)
      if (entry.isDirectory()) {
        if (PROVIDER_OWNED_DIRECTORIES.has(entry.name)) return []
        return listJsonFiles(path)
      }
      if (
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        !IGNORED_JSON_FILES.has(basename(path))
      ) {
        return [path]
      }
      return []
    }),
  )
  return nested.flat()
}

export async function loadDapaInfoProvider(rootPath: string): Promise<DapaInfoProvider> {
  const files = await listJsonFiles(rootPath)
  const entries = await Promise.all(
    files.map(async (path) => {
      const text = await readFile(path, "utf8")
      return DapaInfoFileSchema.parse(JSON.parse(text)).items
    }),
  )
  return new FileDapaInfoProvider(entries.flat(), new Date().toISOString())
}
