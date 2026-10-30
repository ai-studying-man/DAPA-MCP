import { createHash } from "node:crypto"
import { load } from "cheerio"
import { parseCitation } from "../lib/citation/parser.js"
import { DapaError } from "../lib/errors/dapa-error.js"
import { toErrorShape } from "./law/law-provider-response.js"

export function validateDisclosureUrl(value: string): URL {
  const url = new URL(value)
  const kind =
    url.hostname === "kind.krx.co.kr" &&
    url.search === "" &&
    /^\/external\/\d{4}\/\d{2}\/\d{2}\/\d{6}\/\d{14}\/\d+\.htm$/u.test(url.pathname)
  const keys = ["rcpNo", "dcmNo", "eleId", "offset", "length", "dtd"]
  const dart =
    url.hostname === "dart.fss.or.kr" &&
    url.pathname === "/report/viewer.do" &&
    [...url.searchParams.keys()].length === keys.length &&
    keys.every((key) => url.searchParams.getAll(key).length === 1) &&
    /^\d{14}$/u.test(url.searchParams.get("rcpNo") ?? "") &&
    ["dcmNo", "eleId", "offset", "length"].every((key) =>
      /^\d{1,10}$/u.test(url.searchParams.get(key) ?? ""),
    ) &&
    url.searchParams.get("dtd") === "dart3.xsd" &&
    Number(url.searchParams.get("length")) <= 12 * 1024 * 1024
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (!kind && !dart)
  ) {
    throw new DapaError("INVALID_ARGUMENT", "KIND 또는 DART 공식 공시 원문 주소만 지원합니다")
  }
  return url
}

export function disclosureContext(html: string, caseNumber: string) {
  const docket = parseCitation(`대법원 ${caseNumber}`).caseNumber
  if (docket === undefined) throw new DapaError("INVALID_ARGUMENT", "정확한 사건번호가 필요합니다")
  const $ = load(html)
  $("script,style,noscript").remove()
  const text = $.root().text().replace(/\s+/gu, " ").trim()
  const pattern = new RegExp([...docket].join("\\s*"), "gu")
  const positions = [...text.matchAll(pattern)].slice(0, 4).map((match) => match.index)
  const excerpts = [
    ...new Set(
      positions.map((index) => {
        const tail = text.slice(index + docket.length)
        const nextCase = /(?:\d{2}|(?:19|20)\d{2})\s*[가-힣]{1,5}\s*\d{1,8}/u.exec(tail)
        const end =
          nextCase === null
            ? index + 2400
            : Math.min(index + 2400, index + docket.length + nextCase.index)
        return text.slice(Math.max(0, index - 20), end)
      }),
    ),
  ]
  return {
    status: excerpts.length === 0 ? ("NOT_FOUND" as const) : ("OK" as const),
    evidenceKind: "issuer_disclosure" as const,
    partyContext: "issuer_statement_only" as const,
    claimVerification: "not_performed" as const,
    caseNumber: docket,
    excerpts,
    originalCharacters: text.length,
    truncated: true,
  }
}

export async function readOfficialDisclosure(input: {
  readonly url: string
  readonly caseNumber: string
}) {
  try {
    const url = validateDisclosureUrl(input.url)
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8_000) })
    if (!response.ok || response.body === null)
      throw new DapaError("SOURCE_UNAVAILABLE", `공식 공시 원문 HTTP ${response.status}`)
    const maxBytes = 12 * 1024 * 1024
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new DapaError("SOURCE_UNAVAILABLE", "공시 원문 크기 한도 초과")
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new DapaError("SOURCE_UNAVAILABLE", "공시 원문 크기 한도 초과")
      }
      chunks.push(part.value)
    }
    const bytes = Buffer.concat(chunks)
    const encoding = /euc-kr|ks_c_5601/iu.test(response.headers.get("content-type") ?? "")
      ? "euc-kr"
      : "utf-8"
    return {
      ...disclosureContext(new TextDecoder(encoding).decode(bytes), input.caseNumber),
      sourceUrl: url.toString(),
      retrievedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      errors: [],
    }
  } catch (error) {
    return { status: "SOURCE_UNAVAILABLE" as const, errors: [toErrorShape(error)] }
  }
}
