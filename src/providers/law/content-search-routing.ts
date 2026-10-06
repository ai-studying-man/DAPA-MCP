import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { DapaSearchResult, SearchResponse, SourceType } from "../../types/results.js"
import type { LawProvider, LegalSearchInput } from "./law-provider.js"

type MajorDocument = {
  readonly title: string
  readonly sourceType: SourceType
}

const MANAGEMENT = { title: "방위사업관리규정", sourceType: "administrative_rule" } as const
const DEFENSE_LAW = { title: "방위사업법", sourceType: "law" } as const
const TOPIC_ROUTES = [
  {
    terms: /(?:야전운용시험|운용시험|시험평가|전력발전)/u,
    documents: [
      MANAGEMENT,
      { title: "국방전력발전업무훈령", sourceType: "administrative_rule" },
      DEFENSE_LAW,
    ],
  },
  {
    terms: /(?:중도확정계약|특정비목불확정계약|계약금액|원가계산|방산원가)/u,
    documents: [
      { title: "방위사업법 시행령", sourceType: "law" },
      { title: "방위산업에 관한 계약사무 처리규칙", sourceType: "law" },
      { title: "방산원가대상물자의 원가계산에 관한 규칙", sourceType: "law" },
      MANAGEMENT,
    ],
  },
] as const satisfies readonly {
  readonly terms: RegExp
  readonly documents: readonly MajorDocument[]
}[]

export type MajorDocumentDiscovery = {
  readonly searches: readonly SearchResponse[]
  readonly documents: readonly DapaSearchResult[]
}

export async function discoverMajorDocuments(
  law: Pick<LawProvider, "search">,
  input: LegalSearchInput,
): Promise<MajorDocumentDiscovery> {
  const types = input.types ?? ["law", "administrative_rule"]
  const routes = TOPIC_ROUTES.filter(({ terms }) => terms.test(input.query.replace(/\s+/gu, "")))
  const documents = [
    ...new Map(
      routes
        .flatMap<MajorDocument>(({ documents }) => documents)
        .map((document) => [document.title, document]),
    ).values(),
  ].filter(({ sourceType }) => types.includes(sourceType))
  const searches = await Promise.all(
    documents.map(async (document) => {
      const result = await law.search({
        ...input,
        query: document.title,
        types: [document.sourceType],
        searchScope: "title",
        page: 1,
        limit: 20,
      })
      return {
        ...result,
        results: result.results.filter(
          ({ title }) => normalizeSearchText(title) === normalizeSearchText(document.title),
        ),
      }
    }),
  )
  return { searches, documents: searches.flatMap(({ results }) => results) }
}
