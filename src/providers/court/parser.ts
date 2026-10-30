import { load } from "cheerio"
import iconv from "iconv-lite"
import { z } from "zod"
import { DapaError } from "../../lib/errors/dapa-error.js"

const Sequence = z.string().regex(/^\d{1,12}$/u)
const File = z.string().regex(/^[A-Za-z0-9_-]{1,100}\.pdf$/iu)
export type CourtNotice = {
  readonly sequence: string
  readonly title: string
  readonly file: string
  readonly downFile: string
  readonly path: string
}

export function encodeCourtQuery(query: string): string {
  return [...iconv.encode(query, "euc-kr")]
    .map((byte) => `%${byte.toString(16).padStart(2, "0").toUpperCase()}`)
    .join("")
}

export function courtList(bytes: Buffer, base: URL): readonly string[] {
  const $ = load(iconv.decode(bytes, "euc-kr"))
  if ($("#content").length === 0)
    throw new DapaError("SOURCE_UNAVAILABLE", "법원 검색 응답 형식을 확인할 수 없습니다")
  return [
    ...new Set(
      $("#content a[href*='NewsViewAction.work']")
        .toArray()
        .flatMap((element) => {
          const href = $(element).attr("href")
          if (!href) return []
          const url = new URL(href, base)
          const sequence = Sequence.safeParse(url.searchParams.get("seqnum"))
          return url.origin === base.origin &&
            url.pathname === "/portal/news/NewsViewAction.work" &&
            url.searchParams.get("gubun") === "2" &&
            sequence.success
            ? [sequence.data]
            : []
        }),
    ),
  ]
}

export function courtNotices(bytes: Buffer, sequence: string): readonly CourtNotice[] {
  const html = iconv.decode(bytes, "euc-kr")
  const $ = load(html)
  const table = $("#content table.tableVer").first()
  if (table.length === 0)
    throw new DapaError("SOURCE_UNAVAILABLE", "법원 게시글 본문을 확인할 수 없습니다")
  const title = table
    .find("tr")
    .filter((_, row) => $(row).find("th").first().text().trim() === "제목")
    .first()
    .find("td")
    .text()
    .trim()
  const path = /form\.path\.value\s*=\s*['"](\d{3})['"]/u.exec(html)?.[1]
  if (path !== "001") return []
  return table
    .find(".attTxt a[href]")
    .toArray()
    .flatMap((element) => {
      const match =
        /^javascript:download\(['"]([A-Za-z0-9_-]+\.pdf)['"],\s*['"]([^'"<>/\\]+\.pdf)['"]\)\s*;?$/iu.exec(
          $(element).attr("href") ?? "",
        )
      const file = File.safeParse(match?.[1])
      const downFile = match?.[2]
      return file.success &&
        downFile !== undefined &&
        downFile.length < 180 &&
        caseNumber(downFile) !== undefined
        ? [{ sequence, title, file: file.data, downFile, path }]
        : []
    })
}

export function caseNumber(value: string): string | undefined {
  return /(?:^|\s)((?:\d{2}|(?:19|20)\d{2})\s*[가-힣]{1,5}\s*\d{1,8})/u
    .exec(value)?.[1]
    ?.replace(/\s+/gu, "")
}

export function courtIdentifier(documentId: string): {
  readonly sequence: string
  readonly file: string
} {
  const match = /^court:2:(\d{1,12}):([A-Za-z0-9_-]{1,100}\.pdf)$/iu.exec(documentId)
  const sequence = Sequence.safeParse(match?.[1])
  const file = File.safeParse(match?.[2])
  if (!sequence.success || !file.success)
    throw new DapaError("INVALID_ARGUMENT", "법원 검색에서 반환된 documentId만 조회할 수 있습니다")
  return { sequence: sequence.data, file: file.data }
}
