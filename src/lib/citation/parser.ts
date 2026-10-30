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
    /^(.+?(?:법|령|규칙|규정|훈령|예규|고시|조례|지침))\s*(제\d+조(?:의\d+)?)(?:\(([^()]+)\))?\s*((?:제\d+항)?\s*(?:제\d+호)?)$/,
  )
  if (lawMatch) {
    const documentName = lawMatch[1]
    const articleBase = lawMatch[2]
    const claimedArticleTitle = lawMatch[3]
    const articleSuffix = lawMatch[4]?.replace(/\s+/gu, "")
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

  const caseMatch = value.match(
    /^(대법원|헌법재판소|[가-힣]+법원)\s+((?:\d{2}|(?:19|20)\d{2})\s*(?:헌[가나다라마바사아]|재(?:고합|나|다|두|누)?|가소|가단|가합|다카|고단|고합|고정|고약|구단|구합|카단|카합|카기|카명|카확|드단|드합|즈단|즈합|느단|느합|회단|회합|회확|회기|개회|개확|간회|간확|하단|하합|차전|가|나|다|머|자|차|카|그|마|라|바|사|아|타|하|고|노|도|오|초|감|전|보|모|로|코|구|누|두|루|부|수|우|주|드|르|므|브|스|너|버|즈|느|허|후|취|회|파)\s*\d{1,8})$/u,
  )
  if (caseMatch) {
    const documentName = caseMatch[1]
    const caseNumber = caseMatch[2]?.replace(/\s+/gu, "")
    if (documentName !== undefined && caseNumber !== undefined) {
      return { raw: value, kind: "case", documentName, caseNumber }
    }
  }

  return { raw: value, kind: "unknown" }
}
