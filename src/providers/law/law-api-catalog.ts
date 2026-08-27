import { DapaError } from "../../lib/errors/dapa-error.js"

// allow: SIZE_OK — official API capability data table

export const LAW_API_CATEGORY_IDS = [
  "pre_consultation_opinion",
  "central_ministry_interpretation",
  "legal_knowledge_base",
  "customized",
  "legal_term",
  "attachment_form",
  "treaty",
  "constitutional_case",
  "interpretation",
  "administrative_appeal",
  "law",
  "administrative_rule",
  "local_ordinance",
  "precedent",
] as const

export type LawApiCategoryId = (typeof LAW_API_CATEGORY_IDS)[number]

export const LAW_API_IDS = [
  "pre_consultation_opinion.list",
  "pre_consultation_opinion.detail",
  "central_ministry_interpretation.dapa_list",
  "central_ministry_interpretation.dapa_detail",
  "legal_knowledge_base.legal_terms",
  "legal_knowledge_base.daily_terms",
  "legal_knowledge_base.legal_to_daily",
  "legal_knowledge_base.daily_to_legal",
  "legal_knowledge_base.legal_to_articles",
  "legal_knowledge_base.article_to_legal",
  "legal_knowledge_base.related_laws",
  "legal_knowledge_base.ai_search",
  "legal_knowledge_base.ai_related_laws",
  "customized.law_list",
  "customized.law_articles",
  "customized.administrative_rule_list",
  "customized.administrative_rule_articles",
  "customized.local_ordinance_list",
  "customized.local_ordinance_articles",
  "legal_term.list",
  "legal_term.detail",
  "attachment_form.law_list",
  "attachment_form.administrative_rule_list",
  "attachment_form.local_ordinance_list",
  "treaty.list",
  "treaty.detail",
  "constitutional_case.list",
  "constitutional_case.detail",
  "interpretation.list",
  "interpretation.detail",
  "administrative_appeal.list",
  "administrative_appeal.detail",
  "law.list",
  "law.detail",
  "administrative_rule.list",
  "administrative_rule.detail",
  "local_ordinance.list",
  "local_ordinance.detail",
  "precedent.list",
  "precedent.detail",
] as const

export type LawApiId = (typeof LAW_API_IDS)[number]
export type LawApiInputName = "query" | "documentId" | "customCode" | "articleNumber"

export type LawApiConfig = {
  readonly id: LawApiId
  readonly categoryId: LawApiCategoryId
  readonly title: string
  readonly operation: "list" | "detail" | "content"
  readonly endpoint: "lawSearch.do" | "lawService.do"
  readonly target: string
  readonly requiredInputs: readonly LawApiInputName[]
  readonly inputParameters?: Readonly<Partial<Record<LawApiInputName, string>>>
  readonly staticParameters?: Readonly<Record<string, string>>
  readonly paginated?: boolean
  readonly bodyResolution: "detail_api" | "response_body" | "download_link" | "linked_document"
}

export type LawApiCategory = {
  readonly id: LawApiCategoryId
  readonly title: string
  readonly apis: readonly LawApiConfig[]
}

const CATEGORY_TITLES = {
  pre_consultation_opinion: "사전컨설팅 의견서",
  central_ministry_interpretation: "중앙부처 1차 해석",
  legal_knowledge_base: "법령정보 지식베이스",
  customized: "맞춤형",
  legal_term: "법령용어",
  attachment_form: "별표·서식",
  treaty: "조약",
  constitutional_case: "헌재결정례",
  interpretation: "법령해석례",
  administrative_appeal: "행정심판례",
  law: "법령",
  administrative_rule: "행정규칙",
  local_ordinance: "자치법규",
  precedent: "판례",
} satisfies Readonly<Record<LawApiCategoryId, string>>

const API_CONFIGS = [
  api([
    "pre_consultation_opinion.list",
    "pre_consultation_opinion",
    "감사원 사전컨설팅 의견서 목록",
    "list",
    "lawSearch.do",
    "baiPvcs",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "pre_consultation_opinion.detail",
    "pre_consultation_opinion",
    "감사원 사전컨설팅 의견서 본문",
    "detail",
    "lawService.do",
    "baiPvcs",
    ["documentId"],
    { documentId: "ID" },
    false,
    "response_body",
  ]),
  api([
    "central_ministry_interpretation.dapa_list",
    "central_ministry_interpretation",
    "방위사업청 법령해석 목록",
    "list",
    "lawSearch.do",
    "dapaCgmExpc",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "central_ministry_interpretation.dapa_detail",
    "central_ministry_interpretation",
    "방위사업청 법령해석 본문",
    "detail",
    "lawService.do",
    "dapaCgmExpc",
    ["documentId"],
    { documentId: "ID" },
    false,
    "response_body",
  ]),
  api([
    "legal_knowledge_base.legal_terms",
    "legal_knowledge_base",
    "지식베이스 법령용어",
    "list",
    "lawSearch.do",
    "lstrmAI",
    [],
    { query: "query" },
    true,
    "response_body",
  ]),
  api([
    "legal_knowledge_base.daily_terms",
    "legal_knowledge_base",
    "지식베이스 일상용어",
    "list",
    "lawSearch.do",
    "dlytrm",
    [],
    { query: "query" },
    true,
    "response_body",
  ]),
  api([
    "legal_knowledge_base.legal_to_daily",
    "legal_knowledge_base",
    "법령용어-일상용어 연계",
    "content",
    "lawService.do",
    "lstrmRlt",
    ["query"],
    { query: "query" },
    false,
    "response_body",
  ]),
  api([
    "legal_knowledge_base.daily_to_legal",
    "legal_knowledge_base",
    "일상용어-법령용어 연계",
    "content",
    "lawService.do",
    "dlytrmRlt",
    ["query"],
    { query: "query" },
    false,
    "response_body",
  ]),
  api([
    "legal_knowledge_base.legal_to_articles",
    "legal_knowledge_base",
    "법령용어-조문 연계",
    "content",
    "lawService.do",
    "lstrmRltJo",
    ["query"],
    { query: "query" },
    false,
    "response_body",
  ]),
  api([
    "legal_knowledge_base.article_to_legal",
    "legal_knowledge_base",
    "조문-법령용어 연계",
    "content",
    "lawService.do",
    "joRltLstrm",
    ["query", "articleNumber"],
    { query: "query", articleNumber: "JO" },
    false,
    "response_body",
  ]),
  api([
    "legal_knowledge_base.related_laws",
    "legal_knowledge_base",
    "관련법령",
    "content",
    "lawSearch.do",
    "lsRlt",
    ["documentId"],
    { documentId: "ID" },
    false,
    "linked_document",
  ]),
  api([
    "legal_knowledge_base.ai_search",
    "legal_knowledge_base",
    "지능형 법령검색",
    "content",
    "lawSearch.do",
    "aiSearch",
    ["query"],
    { query: "query" },
    true,
    "response_body",
    { search: "0" },
  ]),
  api([
    "legal_knowledge_base.ai_related_laws",
    "legal_knowledge_base",
    "지능형 연관법령",
    "content",
    "lawSearch.do",
    "aiRltLs",
    ["query"],
    { query: "query" },
    true,
    "linked_document",
    { search: "0" },
  ]),
  api([
    "customized.law_list",
    "customized",
    "맞춤형 법령 목록",
    "list",
    "lawSearch.do",
    "couseLs",
    ["customCode"],
    { customCode: "vcode" },
    true,
    "linked_document",
  ]),
  api([
    "customized.law_articles",
    "customized",
    "맞춤형 법령 조문",
    "content",
    "lawSearch.do",
    "couseLs",
    ["customCode"],
    { customCode: "vcode" },
    true,
    "response_body",
    { lj: "jo" },
  ]),
  api([
    "customized.administrative_rule_list",
    "customized",
    "맞춤형 행정규칙 목록",
    "list",
    "lawSearch.do",
    "couseAdmrul",
    ["customCode"],
    { customCode: "vcode" },
    true,
    "linked_document",
  ]),
  api([
    "customized.administrative_rule_articles",
    "customized",
    "맞춤형 행정규칙 조문",
    "content",
    "lawSearch.do",
    "couseAdmrul",
    ["customCode"],
    { customCode: "vcode" },
    true,
    "response_body",
    { lj: "jo" },
  ]),
  api([
    "customized.local_ordinance_list",
    "customized",
    "맞춤형 자치법규 목록",
    "list",
    "lawSearch.do",
    "couseOrdin",
    ["customCode"],
    { customCode: "vcode" },
    true,
    "linked_document",
  ]),
  api([
    "customized.local_ordinance_articles",
    "customized",
    "맞춤형 자치법규 조문",
    "content",
    "lawSearch.do",
    "couseOrdin",
    ["customCode"],
    { customCode: "vcode" },
    true,
    "response_body",
    { lj: "jo" },
  ]),
  api([
    "legal_term.list",
    "legal_term",
    "법령 용어 목록",
    "list",
    "lawSearch.do",
    "lstrm",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "legal_term.detail",
    "legal_term",
    "법령 용어 본문",
    "detail",
    "lawService.do",
    "lstrm",
    ["query"],
    { query: "query" },
    false,
    "response_body",
  ]),
  api([
    "attachment_form.law_list",
    "attachment_form",
    "법령 별표·서식 목록",
    "list",
    "lawSearch.do",
    "licbyl",
    [],
    { query: "query" },
    true,
    "download_link",
  ]),
  api([
    "attachment_form.administrative_rule_list",
    "attachment_form",
    "행정규칙 별표·서식 목록",
    "list",
    "lawSearch.do",
    "admbyl",
    [],
    { query: "query" },
    true,
    "download_link",
  ]),
  api([
    "attachment_form.local_ordinance_list",
    "attachment_form",
    "자치법규 별표·서식 목록",
    "list",
    "lawSearch.do",
    "ordinbyl",
    [],
    { query: "query" },
    true,
    "download_link",
  ]),
  api([
    "treaty.list",
    "treaty",
    "조약 목록",
    "list",
    "lawSearch.do",
    "trty",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "treaty.detail",
    "treaty",
    "조약 본문",
    "detail",
    "lawService.do",
    "trty",
    ["documentId"],
    { documentId: "ID" },
    false,
    "response_body",
  ]),
  api([
    "constitutional_case.list",
    "constitutional_case",
    "헌재결정례 목록",
    "list",
    "lawSearch.do",
    "detc",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "constitutional_case.detail",
    "constitutional_case",
    "헌재결정례 본문",
    "detail",
    "lawService.do",
    "detc",
    ["documentId"],
    { documentId: "ID" },
    false,
    "response_body",
  ]),
  api([
    "interpretation.list",
    "interpretation",
    "법령해석례 목록",
    "list",
    "lawSearch.do",
    "expc",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "interpretation.detail",
    "interpretation",
    "법령해석례 본문",
    "detail",
    "lawService.do",
    "expc",
    ["documentId"],
    { documentId: "ID" },
    false,
    "response_body",
  ]),
  api([
    "administrative_appeal.list",
    "administrative_appeal",
    "행정심판례 목록",
    "list",
    "lawSearch.do",
    "decc",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "administrative_appeal.detail",
    "administrative_appeal",
    "행정심판례 본문",
    "detail",
    "lawService.do",
    "decc",
    ["documentId"],
    { documentId: "ID" },
    false,
    "response_body",
  ]),
  api([
    "law.list",
    "law",
    "현행법령 목록",
    "list",
    "lawSearch.do",
    "law",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "law.detail",
    "law",
    "현행법령 본문",
    "detail",
    "lawService.do",
    "law",
    ["documentId"],
    { documentId: "MST" },
    false,
    "response_body",
  ]),
  api([
    "administrative_rule.list",
    "administrative_rule",
    "행정규칙 목록",
    "list",
    "lawSearch.do",
    "admrul",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "administrative_rule.detail",
    "administrative_rule",
    "행정규칙 본문",
    "detail",
    "lawService.do",
    "admrul",
    ["documentId"],
    { documentId: "ID" },
    false,
    "response_body",
  ]),
  api([
    "local_ordinance.list",
    "local_ordinance",
    "자치법규 목록",
    "list",
    "lawSearch.do",
    "ordin",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "local_ordinance.detail",
    "local_ordinance",
    "자치법규 본문",
    "detail",
    "lawService.do",
    "ordin",
    ["documentId"],
    { documentId: "MST" },
    false,
    "response_body",
  ]),
  api([
    "precedent.list",
    "precedent",
    "판례 목록",
    "list",
    "lawSearch.do",
    "prec",
    [],
    { query: "query" },
    true,
    "detail_api",
  ]),
  api([
    "precedent.detail",
    "precedent",
    "판례 본문",
    "detail",
    "lawService.do",
    "prec",
    ["documentId"],
    { documentId: "ID" },
    false,
    "response_body",
  ]),
] satisfies readonly LawApiConfig[]

const BODY_API_IDS = new Map<LawApiId, LawApiId>([
  ["pre_consultation_opinion.list", "pre_consultation_opinion.detail"],
  ["central_ministry_interpretation.dapa_list", "central_ministry_interpretation.dapa_detail"],
  ["legal_knowledge_base.related_laws", "law.detail"],
  ["legal_knowledge_base.ai_related_laws", "law.detail"],
  ["customized.law_list", "law.detail"],
  ["customized.administrative_rule_list", "administrative_rule.detail"],
  ["customized.local_ordinance_list", "local_ordinance.detail"],
  ["legal_term.list", "legal_term.detail"],
  ["treaty.list", "treaty.detail"],
  ["constitutional_case.list", "constitutional_case.detail"],
  ["interpretation.list", "interpretation.detail"],
  ["administrative_appeal.list", "administrative_appeal.detail"],
  ["law.list", "law.detail"],
  ["administrative_rule.list", "administrative_rule.detail"],
  ["local_ordinance.list", "local_ordinance.detail"],
  ["precedent.list", "precedent.detail"],
])

const BODY_REFERENCE_FIELDS = new Map<LawApiId, readonly string[]>([
  ["pre_consultation_opinion.list", ["사전컨설팅의견서일련번호", "사전컨설팅일련번호"]],
  ["central_ministry_interpretation.dapa_list", ["법령해석일련번호"]],
  ["legal_knowledge_base.related_laws", ["법령일련번호", "법령ID"]],
  ["legal_knowledge_base.ai_related_laws", ["법령일련번호", "법령ID"]],
  ["customized.law_list", ["법령일련번호", "법령ID"]],
  ["customized.administrative_rule_list", ["행정규칙일련번호", "행정규칙ID"]],
  ["customized.local_ordinance_list", ["자치법규일련번호", "자치법규ID"]],
  ["legal_term.list", ["법령용어명", "법령용어", "용어명"]],
  ["attachment_form.law_list", ["별표서식파일링크", "별표서식PDF파일링크"]],
  ["attachment_form.administrative_rule_list", ["별표서식파일링크", "별표서식PDF파일링크"]],
  ["attachment_form.local_ordinance_list", ["별표서식파일링크", "별표서식PDF파일링크"]],
  ["treaty.list", ["조약일련번호"]],
  ["constitutional_case.list", ["헌재결정례일련번호"]],
  ["interpretation.list", ["법령해석례일련번호"]],
  ["administrative_appeal.list", ["행정심판재결례일련번호"]],
  ["law.list", ["법령일련번호", "법령ID"]],
  ["administrative_rule.list", ["행정규칙일련번호", "행정규칙ID"]],
  ["local_ordinance.list", ["자치법규일련번호", "자치법규ID"]],
  ["precedent.list", ["판례일련번호"]],
])

const BODY_REFERENCE_INPUTS = new Map<LawApiId, LawApiInputName>([
  ["pre_consultation_opinion.list", "documentId"],
  ["central_ministry_interpretation.dapa_list", "documentId"],
  ["legal_knowledge_base.related_laws", "documentId"],
  ["legal_knowledge_base.ai_related_laws", "documentId"],
  ["customized.law_list", "documentId"],
  ["customized.administrative_rule_list", "documentId"],
  ["customized.local_ordinance_list", "documentId"],
  ["legal_term.list", "query"],
  ["treaty.list", "documentId"],
  ["constitutional_case.list", "documentId"],
  ["interpretation.list", "documentId"],
  ["administrative_appeal.list", "documentId"],
  ["law.list", "documentId"],
  ["administrative_rule.list", "documentId"],
  ["local_ordinance.list", "documentId"],
  ["precedent.list", "documentId"],
])

const CONFIG_BY_ID = new Map<LawApiId, LawApiConfig>(
  API_CONFIGS.map((config) => [config.id, config]),
)

export function getLawApiConfig(apiId: LawApiId): LawApiConfig {
  const config = CONFIG_BY_ID.get(apiId)
  if (config === undefined) {
    throw new DapaError("INTERNAL_ERROR", `법령 API 설정을 찾을 수 없습니다: ${apiId}`)
  }
  return config
}

export function getLawApiBodyApiId(apiId: LawApiId): LawApiId | undefined {
  const config = getLawApiConfig(apiId)
  switch (config.bodyResolution) {
    case "response_body":
      return apiId
    case "detail_api":
    case "linked_document": {
      const bodyApiId = BODY_API_IDS.get(apiId)
      if (bodyApiId === undefined) {
        throw new DapaError("INTERNAL_ERROR", `본문 API 연결 설정을 찾을 수 없습니다: ${apiId}`)
      }
      return bodyApiId
    }
    case "download_link":
      return undefined
    default:
      return assertNever(config.bodyResolution)
  }
}

export function getLawApiBodyReferenceFields(apiId: LawApiId): readonly string[] {
  return BODY_REFERENCE_FIELDS.get(apiId) ?? []
}

export function getLawApiBodyReferenceInput(apiId: LawApiId): LawApiInputName | undefined {
  return BODY_REFERENCE_INPUTS.get(apiId)
}

export function listLawApiCategories(categoryId?: LawApiCategoryId): readonly LawApiCategory[] {
  return LAW_API_CATEGORY_IDS.flatMap((id) => {
    if (categoryId !== undefined && id !== categoryId) return []
    return [
      { id, title: CATEGORY_TITLES[id], apis: API_CONFIGS.filter((api) => api.categoryId === id) },
    ]
  })
}

type LawApiRow = readonly [
  id: LawApiId,
  categoryId: LawApiCategoryId,
  title: string,
  operation: LawApiConfig["operation"],
  endpoint: LawApiConfig["endpoint"],
  target: string,
  requiredInputs: readonly LawApiInputName[],
  inputParameters: LawApiConfig["inputParameters"],
  paginated: boolean,
  bodyResolution: LawApiConfig["bodyResolution"],
  staticParameters?: LawApiConfig["staticParameters"],
]

function api(row: LawApiRow): LawApiConfig {
  const [
    id,
    categoryId,
    title,
    operation,
    endpoint,
    target,
    requiredInputs,
    inputParameters,
    paginated,
    bodyResolution,
    staticParameters,
  ] = row
  return {
    id,
    categoryId,
    title,
    operation,
    endpoint,
    target,
    requiredInputs,
    ...(inputParameters === undefined ? {} : { inputParameters }),
    ...(staticParameters === undefined ? {} : { staticParameters }),
    ...(paginated ? { paginated: true } : {}),
    bodyResolution,
  }
}

function assertNever(value: never): never {
  throw new DapaError("INTERNAL_ERROR", `처리할 수 없는 본문 연결 형식: ${String(value)}`)
}
