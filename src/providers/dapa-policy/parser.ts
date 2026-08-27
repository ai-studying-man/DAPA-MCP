import { load } from "cheerio"
import { DapaError } from "../../lib/errors/dapa-error.js"
import { type DapaPolicyPage, DapaPolicyPageSchema } from "./schemas.js"

export type DapaPolicyLink = {
  readonly menuSeq: string
  readonly title: string
  readonly section: string
  readonly url: string
}

export function parseDapaWorkPolicyNavigation(
  html: string,
  sourceUrl: string,
): readonly DapaPolicyLink[] {
  const $ = load(html)
  const links = new Map<string, DapaPolicyLink>()
  const activeSection =
    cleanText($("#side-manu .depth2-anchor.active").first().text()) ||
    cleanText($("#side-manu .depth2").first().children(".depth2-anchor").first().text())

  $("#side-manu .depth2").each((_index, element) => {
    const item = $(element)
    const section = cleanText(item.children(".depth2-anchor").first().text())
    const children = item.find(".depth3-anchor")
    if (children.length > 0) {
      children.each((_childIndex, child) =>
        addLink($(child).attr("href"), $(child).text(), section),
      )
      return
    }
    const anchor = item.children(".depth2-anchor").first()
    addLink(anchor.attr("href"), anchor.text(), section)
  })

  $("#tab-menu .tab-btn").each((_index, element) => {
    const anchor = $(element)
    addLink(anchor.attr("href"), anchor.text(), activeSection)
  })
  return [...links.values()]

  function addLink(href: string | undefined, rawTitle: string, section: string): void {
    if (href === undefined || section.length === 0) return
    const url = new URL(href, sourceUrl)
    if (!isDapaHost(url.hostname)) return
    const menuSeq = url.searchParams.get("menuSeq")
    const title = cleanText(rawTitle)
    if (menuSeq === null || title.length === 0 || links.has(menuSeq)) return
    links.set(menuSeq, { menuSeq, title, section, url: url.toString() })
  }
}

export function parseDapaPolicyPage(
  html: string,
  sourceUrl: string,
  retrievedAt = new Date().toISOString(),
): DapaPolicyPage {
  const $ = load(html)
  const url = new URL(sourceUrl)
  const menuSeq = url.searchParams.get("menuSeq")
  if (menuSeq === null) {
    throw new DapaError("SOURCE_UNAVAILABLE", "DAPA 업무·정책 페이지에 menuSeq가 없습니다")
  }
  const tabMenuSeqs = new Set<string>()
  $("#cont #tab-menu .tab-btn[href*='menuSeq=']").each((_index, element) => {
    const href = $(element).attr("href")
    if (href === undefined) return
    const value = new URL(href, sourceUrl).searchParams.get("menuSeq")
    if (value !== null) tabMenuSeqs.add(value)
  })
  const tabTitle =
    tabMenuSeqs.size > 1
      ? cleanText($("#cont #tab-menu .tab-btn.active[href*='menuSeq=']").first().text())
      : ""
  const title = tabTitle || cleanText($("#cont .head-tit").first().text())
  const breadcrumbs = $("#cont .new_breadcrumbs .breadcrumbs-item")
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter((value) => value.length > 0 && value !== "홈")
  const section = breadcrumbs[1] ?? breadcrumbs[0] ?? title
  const contentRoot = $("#cont #contents").first().clone()
  contentRoot.find("#tab-menu, #satisfaction, script, style, noscript, .behind").remove()
  contentRoot.find("br").replaceWith("\n")
  contentRoot.find("tr").each((_index, element) => {
    const row = $(element)
    const cells = row
      .find("th, td")
      .map((_cellIndex, cell) => cleanText($(cell).text()))
      .get()
      .filter((value) => value.length > 0)
    row.text(cells.join(" | "))
  })
  contentRoot.find("li").each((_index, element) => {
    $(element).prepend("• ").append("\n")
  })
  contentRoot.find("h1, h2, h3, h4, h5, h6, p, tr, dt, dd").append("\n")
  const content = cleanMultilineText(contentRoot.text())
  return DapaPolicyPageSchema.parse({
    id: `policy:${menuSeq}`,
    menuSeq,
    ...(url.searchParams.get("pageSeq") === null
      ? {}
      : { pageSeq: url.searchParams.get("pageSeq") }),
    title,
    section,
    breadcrumbs,
    content,
    sourceUrl: url.toString(),
    retrievedAt,
  })
}

function isDapaHost(hostname: string): boolean {
  return hostname === "dapa.go.kr" || hostname.endsWith(".dapa.go.kr")
}

function cleanText(value: string): string {
  return value
    .replace(/선택됨/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanMultilineText(value: string): string {
  return value
    .split("\n")
    .map(cleanText)
    .filter((line) => line.length > 0)
    .join("\n")
}
