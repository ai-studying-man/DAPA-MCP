import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import ky, { HTTPError, type KyInstance, TimeoutError } from "ky"
import { DapaError } from "../../lib/errors/dapa-error.js"
import { parseDapaAdminRulePage, parseDapaLawPage } from "./parser.js"
import { type DapaCatalogFile, DapaCatalogFileSchema, type DapaCatalogItem } from "./schemas.js"

export type DapaCatalogSyncConfig = {
  readonly lawSourceUrl: string
  readonly adminRuleSourceUrl: string
  readonly timeoutMs?: number
  readonly retryLimit?: number
  readonly pageSize?: number
}

const DEFAULT_SYNC_CONFIG = {
  lawSourceUrl: "https://www.dapa.go.kr/dapa/page/selectPage.do?menuSeq=3087&pageSeq=3246",
  adminRuleSourceUrl: "https://www.dapa.go.kr/dapa/rlm/rllawd/RlmNttList.do?menuSeq=3088",
  timeoutMs: 15_000,
  retryLimit: 2,
  pageSize: 30,
} as const

export async function syncDapaCatalog(
  config: DapaCatalogSyncConfig = DEFAULT_SYNC_CONFIG,
): Promise<DapaCatalogFile> {
  const resolved = { ...DEFAULT_SYNC_CONFIG, ...config }
  const client = ky.create({
    timeout: resolved.timeoutMs,
    retry: { limit: resolved.retryLimit, methods: ["get"], statusCodes: [429, 500, 502, 503, 504] },
  })
  const retrievedAt = new Date().toISOString()
  const lawHtml = await getText(client, resolved.lawSourceUrl)
  const lawItems = parseDapaLawPage(lawHtml, resolved.lawSourceUrl, retrievedAt)
  const firstPageUrl = buildAdminPageUrl(resolved.adminRuleSourceUrl, 1, resolved.pageSize)
  const firstPage = parseDapaAdminRulePage(
    await getText(client, firstPageUrl),
    firstPageUrl,
    retrievedAt,
  )
  const adminItems: DapaCatalogItem[] = [...firstPage.items]
  for (let page = 2; page <= firstPage.pageCount; page += 1) {
    const pageUrl = buildAdminPageUrl(resolved.adminRuleSourceUrl, page, resolved.pageSize)
    const parsed = parseDapaAdminRulePage(await getText(client, pageUrl), pageUrl, retrievedAt)
    adminItems.push(...parsed.items)
  }
  if (adminItems.length !== firstPage.totalCount) {
    throw new DapaError(
      "SOURCE_UNAVAILABLE",
      `DAPA 행정규칙 목록 건수 불일치: ${adminItems.length}/${firstPage.totalCount}`,
    )
  }
  const items = [...lawItems, ...adminItems]
  assertUniqueIds(items)
  return DapaCatalogFileSchema.parse({
    schemaVersion: 1,
    generatedAt: retrievedAt,
    lawSourceUrl: resolved.lawSourceUrl,
    adminRuleSourceUrl: resolved.adminRuleSourceUrl,
    pageCount: firstPage.pageCount,
    items,
  })
}

export async function writeDapaCatalog(path: string, catalog: DapaCatalogFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")
}

function buildAdminPageUrl(sourceUrl: string, page: number, pageSize: number): string {
  const url = new URL(sourceUrl)
  url.searchParams.set("currPage", String(page))
  url.searchParams.set("listCo", String(pageSize))
  url.searchParams.set("searchValue", "")
  url.searchParams.set("ruleId", "24422")
  url.searchParams.set("SelctgryId", "")
  url.searchParams.set("SelcnsntNo", "")
  return url.toString()
}

async function getText(client: KyInstance, url: string): Promise<string> {
  try {
    return await client.get(url).text()
  } catch (error) {
    if (error instanceof TimeoutError)
      throw new DapaError("TIMEOUT", "DAPA 공식 페이지 요청 시간이 초과되었습니다", {
        cause: error,
      })
    if (error instanceof HTTPError) {
      const status = error.response.status
      const code = status === 429 ? "RATE_LIMITED" : "SOURCE_UNAVAILABLE"
      throw new DapaError(code, `DAPA 공식 페이지가 HTTP ${status}를 반환했습니다`, {
        cause: error,
      })
    }
    throw new DapaError("SOURCE_UNAVAILABLE", "DAPA 공식 페이지에 연결할 수 없습니다", {
      cause: error,
    })
  }
}

function assertUniqueIds(items: readonly DapaCatalogItem[]): void {
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.id))
      throw new DapaError("SOURCE_UNAVAILABLE", `DAPA 카탈로그 중복 ID: ${item.id}`)
    ids.add(item.id)
  }
}
