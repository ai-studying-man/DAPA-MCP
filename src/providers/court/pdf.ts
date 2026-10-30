import { createHash } from "node:crypto"
import { load } from "cheerio"
import { DapaError } from "../../lib/errors/dapa-error.js"
import { caseNumber } from "./parser.js"

export async function courtPdf(bytes: Buffer, expectedCase: string, deadlineAt: number) {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new DapaError("SOURCE_UNAVAILABLE", "법원 첨부 응답이 실제 PDF 원문이 아닙니다")
  }
  const { parse } = await import("kordoc")
  const parsed = await parse(bytes, { ocr: false })
  if (Date.now() >= deadlineAt)
    throw new DapaError("TIMEOUT", "법원 PDF 변환 시간 한도를 초과했습니다")
  if (!parsed.success || parsed.markdown.trim().length === 0) {
    throw new DapaError("SOURCE_UNAVAILABLE", "법원 PDF 원문을 텍스트로 확인할 수 없습니다")
  }
  const text = parsed.markdown
  const identity = courtPdfIdentity(text)
  const actualCase = identity.caseNumber
  if (actualCase !== expectedCase) {
    throw new DapaError(
      "SOURCE_UNAVAILABLE",
      "첨부파일 사건번호와 판결서 주사건번호가 일치하지 않습니다",
    )
  }
  return {
    text: text.slice(0, 120_000),
    truncated: text.length > 120_000,
    originalCharacters: text.length,
    caseNumber: actualCase,
    pageCount: parsed.pageCount,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    date: identity.date,
    organization: identity.organization,
  }
}

export function courtPdfIdentity(text: string) {
  const $ = load(text.slice(0, 5000))
  const rows = $("tr")
    .toArray()
    .map((row) =>
      $(row)
        .find("td,th")
        .toArray()
        .map((cell) => $(cell).text().trim()),
    )
  const main = rows.find(
    (cells) => cells.includes("사건") || (cells.includes("사") && cells.includes("건")),
  )
  const plain = $.root().text()
  const heading = /사\s*건[\s|:：]*((?:\d{2}|(?:19|20)\d{2})\s*[가-힣]{1,5}\s*\d{1,8})/u.exec(
    plain,
  )?.[1]
  const actualCase =
    main === undefined
      ? heading === undefined
        ? undefined
        : caseNumber(heading)
      : caseNumber(main.join(" "))
  const dateRow = rows.find((cells) =>
    cells.some((cell) => cell.replace(/\s+/gu, "") === "판결선고"),
  )
  const dateText = dateRow?.join(" ") ?? plain
  const dateMatch = /판\s*결\s*선\s*고[\s|:：]*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./u.exec(
    dateText,
  )
  const date =
    dateMatch?.[1] && dateMatch[2] && dateMatch[3]
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
      : undefined
  const organization = /대\s*법\s*원|[가-힣]{2,10}(?:고등|지방|가정|행정|특허)법원/u
    .exec(plain.slice(0, 250))?.[0]
    ?.replace(/\s+/gu, "")
  return { caseNumber: actualCase, date, ...(organization === undefined ? {} : { organization }) }
}
