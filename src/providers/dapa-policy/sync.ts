import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import ky, { HTTPError, type KyInstance, TimeoutError } from "ky"
import { DapaError } from "../../lib/errors/dapa-error.js"
import { parseDapaPolicyPage, parseDapaWorkPolicyNavigation } from "./parser.js"
import { type DapaPolicyFile, DapaPolicyFileSchema, type DapaPolicyPage } from "./schemas.js"

export type DapaPolicySyncConfig = {
  readonly seedUrl?: string
  readonly timeoutMs?: number
  readonly retryLimit?: number
}

const DEFAULT_SYNC_CONFIG = {
  seedUrl: "https://www.dapa.go.kr/dapa/page/selectPage.do?menuSeq=4088&pageSeq=4198",
  timeoutMs: 15_000,
  retryLimit: 2,
} as const

type FetchedPage = {
  readonly html: string
  readonly url: string
}

export async function syncDapaPolicy(
  config: DapaPolicySyncConfig = DEFAULT_SYNC_CONFIG,
): Promise<DapaPolicyFile> {
  const resolved = { ...DEFAULT_SYNC_CONFIG, ...config }
  const client = ky.create({
    timeout: resolved.timeoutMs,
    retry: { limit: resolved.retryLimit, methods: ["get"], statusCodes: [429, 500, 502, 503, 504] },
  })
  const retrievedAt = new Date().toISOString()
  const seed = await getPage(client, resolved.seedUrl)
  const queue = [
    { menuSeq: new URL(seed.url).searchParams.get("menuSeq") ?? "", url: seed.url },
    ...parseDapaWorkPolicyNavigation(seed.html, seed.url),
  ]
  const visited = new Set<string>()
  const pages = new Map<string, DapaPolicyPage>()

  while (queue.length > 0) {
    if (visited.size >= 100) {
      throw new DapaError(
        "SOURCE_UNAVAILABLE",
        "DAPA 업무·정책 탐색 범위가 100페이지를 초과했습니다",
      )
    }
    const target = queue.shift()
    if (target === undefined || target.menuSeq.length === 0 || visited.has(target.menuSeq)) continue
    visited.add(target.menuSeq)
    const fetched = target.url === seed.url ? seed : await getPage(client, target.url)
    const page = parseDapaPolicyPage(fetched.html, fetched.url, retrievedAt)
    pages.set(page.id, page)
    for (const link of parseDapaWorkPolicyNavigation(fetched.html, fetched.url)) {
      if (!visited.has(link.menuSeq)) queue.push(link)
    }
  }

  return DapaPolicyFileSchema.parse({
    schemaVersion: 1,
    generatedAt: retrievedAt,
    seedUrl: resolved.seedUrl,
    pages: [...pages.values()].sort((left, right) => Number(left.menuSeq) - Number(right.menuSeq)),
  })
}

export async function writeDapaPolicy(path: string, catalog: DapaPolicyFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")
}

async function getPage(client: KyInstance, url: string): Promise<FetchedPage> {
  try {
    const response = await client.get(url)
    return { html: await response.text(), url: response.url }
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new DapaError("TIMEOUT", "DAPA 업무·정책 페이지 요청 시간이 초과되었습니다", {
        cause: error,
      })
    }
    if (error instanceof HTTPError) {
      const status = error.response.status
      const code = status === 429 ? "RATE_LIMITED" : "SOURCE_UNAVAILABLE"
      throw new DapaError(code, `DAPA 업무·정책 페이지가 HTTP ${status}를 반환했습니다`, {
        cause: error,
      })
    }
    throw new DapaError("SOURCE_UNAVAILABLE", "DAPA 업무·정책 페이지에 연결할 수 없습니다", {
      cause: error,
    })
  }
}
