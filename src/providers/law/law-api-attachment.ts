import { load } from "cheerio"
import { parse } from "kordoc"
import { DapaError } from "../../lib/errors/dapa-error.js"
import { removeOcSearchParams, sanitizeUrlString } from "./law-api-sanitize.js"
import type { LawHttpClient } from "./law-http.js"

const ATTACHMENT_PATHS = new Set([
  "/flDownload.do",
  "/flDownloadPdf.do",
  "/LSW/flDownload.do",
  "/LSW/flDownloadPdf.do",
])

export type LawApiAttachment = {
  readonly fileType: string
  readonly contentType: string
  readonly content: string
  readonly sourceUrl: string
  readonly pageCount?: number
}

export async function retrieveLawApiAttachment(
  http: LawHttpClient,
  siteBaseUrl: URL,
  attachmentUrl: string,
): Promise<LawApiAttachment> {
  const url = resolveAttachmentUrl(siteBaseUrl, attachmentUrl)
  const resource = await http.getResource(url)
  if (resource.contentType.startsWith("text/")) {
    const rawText = new TextDecoder().decode(resource.bytes)
    const content = resource.contentType.startsWith("text/html")
      ? load(rawText).root().text().replace(/\s+/g, " ").trim()
      : rawText
    return {
      fileType: "text",
      contentType: resource.contentType,
      content,
      sourceUrl: sanitizeUrlString(url.toString()),
    }
  }

  const parsed = await parse(resource.bytes)
  if (!parsed.success) {
    throw new DapaError(
      "SOURCE_UNAVAILABLE",
      `별표·서식 원문을 텍스트로 변환할 수 없습니다: ${parsed.error}`,
    )
  }
  return {
    fileType: parsed.fileType,
    contentType: resource.contentType,
    content: parsed.markdown,
    sourceUrl: sanitizeUrlString(url.toString()),
    ...(parsed.pageCount === undefined ? {} : { pageCount: parsed.pageCount }),
  }
}

function resolveAttachmentUrl(siteBaseUrl: URL, value: string): URL {
  const url = new URL(value, siteBaseUrl)
  if (url.origin !== siteBaseUrl.origin || !ATTACHMENT_PATHS.has(url.pathname)) {
    throw new DapaError(
      "INVALID_ARGUMENT",
      "별표·서식 목록이 반환한 법제처 공식 다운로드 링크만 조회할 수 있습니다",
    )
  }
  removeOcSearchParams(url)
  return url
}
