export const CITATION_KINDS = ["law", "case", "unknown"] as const

export type CitationKind = (typeof CITATION_KINDS)[number]

export type ParsedCitation = {
  readonly raw: string
  readonly kind: CitationKind
  readonly documentName?: string
  readonly article?: string
  readonly claimedArticleTitle?: string
  readonly caseNumber?: string
}

export function parseCitation(_value: string): ParsedCitation {
  const value = _value.trim()
  const lawMatch = value.match(
    /^(.+?(?:법|령|규칙|규정|훈령|예규|고시|조례))\s*(제\d+조(?:의\d+)?)(?:\(([^()]+)\))?((?:제\d+항)?(?:제\d+호)?)$/,
  )
  if (lawMatch) {
    const documentName = lawMatch[1]
    const articleBase = lawMatch[2]
    const claimedArticleTitle = lawMatch[3]
    const articleSuffix = lawMatch[4]
    const article = articleBase === undefined ? undefined : `${articleBase}${articleSuffix ?? ""}`
    if (documentName !== undefined && article !== undefined) {
      return {
        raw: value,
        kind: "law",
        documentName: documentName.trim(),
        article,
        ...(claimedArticleTitle === undefined ? {} : { claimedArticleTitle }),
      }
    }
  }

  const caseMatch = value.match(/^(대법원|헌법재판소|[가-힣]+법원)\s+(\d{4}[가-힣]{1,4}\d+)$/)
  if (caseMatch) {
    const documentName = caseMatch[1]
    const caseNumber = caseMatch[2]
    if (documentName !== undefined && caseNumber !== undefined) {
      return { raw: value, kind: "case", documentName, caseNumber }
    }
  }

  return { raw: value, kind: "unknown" }
}
