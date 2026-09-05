import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getDapaLegalContent } from "../providers/dapa-catalog/content.js"
import type { DapaCatalogProvider } from "../providers/dapa-catalog/provider.js"
import { DAPA_CATEGORIES } from "../providers/dapa-info/categories.js"
import type { DapaInfoProvider } from "../providers/dapa-info/dapa-info-provider.js"
import type { DapaPolicyProvider } from "../providers/dapa-policy/provider.js"
import type { CitationVerifier } from "../providers/law/citation-verifier.js"
import type { LawApiProvider } from "../providers/law/law-api-provider.js"
import type { LawProvider } from "../providers/law/law-provider.js"
import type { SearchResponse } from "../types/results.js"
import { registerDapaPolicyTools } from "./register-dapa-policy-tools.js"
import { registerLawApiTools } from "./register-law-api-tools.js"
import { registerLegalContentTools } from "./register-legal-content-tools.js"
import { READ_ONLY_ANNOTATIONS, textResult } from "./tool-response.js"

const LEGAL_SOURCE_TYPES = [
  "law",
  "administrative_rule",
  "local_ordinance",
  "precedent",
  "constitutional_case",
  "interpretation",
  "administrative_appeal",
  "committee_decision",
] as const

const SearchLegalSchema = {
  query: z.string().min(1).describe("법령·판례·해석례 검색어"),
  types: z.array(z.enum(LEGAL_SOURCE_TYPES)).max(8).default(["law"]),
  currentOnly: z.boolean().default(true),
  forceRefresh: z
    .boolean()
    .default(false)
    .describe("캐시를 사용하지 않고 API에서 다시 조회합니다."),
  asOfDate: z.iso.date().optional().describe("특정 시점 YYYY-MM-DD; 미지원 시 명시적 오류 반환"),
  organization: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(10),
}

const GetLegalDetailSchema = {
  documentId: z.string().min(1).describe("검색 결과의 documentId"),
  sourceType: z.enum(LEGAL_SOURCE_TYPES),
  forceRefresh: z.boolean().default(false),
}

const VerifyCitationsSchema = {
  citations: z.array(z.string().min(1)).min(1).max(20),
}

const SearchDapaInfoSchema = {
  query: z.string().min(1),
  categories: z.array(z.enum(DAPA_CATEGORIES)).optional(),
  limit: z.number().int().min(1).max(50).default(10),
}

const SearchDapaCatalogSchema = {
  query: z.string().min(1),
  kind: z.enum(["law", "admin_rule"]).optional(),
  category: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(10),
}

const GetOrganizationSchema = {
  query: z.string().min(1).describe("조직명 또는 별칭"),
}

type ToolDependencies = {
  readonly law: LawProvider
  readonly lawApi: LawApiProvider
  readonly dapaInfo: DapaInfoProvider
  readonly dapaCatalog: DapaCatalogProvider
  readonly dapaPolicy: DapaPolicyProvider
  readonly citations: CitationVerifier
  readonly maxLawApiToolResponseChars: number
  readonly legalContentSearchBudgetMs: number
}

export function registerTools(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    "search_legal",
    {
      title: "공식 법령·판례 검색",
      description: "공식 국가법령정보 API에서 법령·행정규칙·자치법규·판례·해석례를 검색합니다.",
      inputSchema: SearchLegalSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      toToolResult(
        await dependencies.law.search({
          query: input.query,
          types: input.types,
          currentOnly: input.currentOnly,
          forceRefresh: input.forceRefresh,
          limit: input.limit,
          ...(input.asOfDate === undefined ? {} : { asOfDate: input.asOfDate }),
          ...(input.organization === undefined ? {} : { organization: input.organization }),
        }),
      ),
  )

  server.registerTool(
    "get_legal_detail",
    {
      title: "공식 법령·판례 상세 조회",
      description: "search_legal에서 받은 documentId로 공식 문서 상세를 조회합니다.",
      inputSchema: GetLegalDetailSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => toToolResult(await dependencies.law.getDetail(input)),
  )

  registerLawApiTools(server, dependencies.lawApi, dependencies.maxLawApiToolResponseChars)
  registerLegalContentTools(server, dependencies.law, dependencies.legalContentSearchBudgetMs)

  server.registerTool(
    "get_legal_history",
    {
      title: "법령 연혁 조회",
      description: "공식 국가법령정보에서 법령의 제정·개정·폐지 연혁을 조회합니다.",
      inputSchema: {
        lawName: z.string().min(1).describe("정확한 법령명"),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ lawName, limit }) => textResult(await dependencies.law.getHistory({ lawName, limit })),
  )

  server.registerTool(
    "verify_citations",
    {
      title: "법령 인용 검증",
      description:
        "법령·행정규칙·자치법규 조문 또는 판례·헌재 사건번호가 공식 출처에 실제 존재하는지 검증합니다.",
      inputSchema: VerifyCitationsSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ citations }) =>
      textResult({ results: await dependencies.citations.verify(citations) }),
  )

  server.registerTool(
    "search_dapa_info",
    {
      title: "방위사업청 업무정보 검색",
      description: "공개 출처 기반 DAPA_info에서 조직·용어·업무 지식을 검색합니다.",
      inputSchema: SearchDapaInfoSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      toToolResult(
        dependencies.dapaInfo.search({
          query: input.query,
          limit: input.limit,
          ...(input.categories === undefined ? {} : { categories: input.categories }),
        }),
      ),
  )

  server.registerTool(
    "get_dapa_organization",
    {
      title: "방위사업청 조직정보 조회",
      description: "방위사업청 조직명 또는 별칭으로 조직 상세를 조회합니다.",
      inputSchema: GetOrganizationSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query }) => {
      const organization = dependencies.dapaInfo.getOrganization(query)
      const response: SearchResponse =
        organization === undefined
          ? { status: "NOT_FOUND", results: [], errors: [] }
          : { status: "OK", results: [organization], errors: [] }
      return toToolResult(response)
    },
  )

  registerDapaPolicyTools(server, dependencies.dapaPolicy)

  server.registerTool(
    "search_dapa_legal_catalog",
    {
      title: "방위사업청 법령·행정규칙 검색",
      description: "방위사업청 공식 홈페이지의 법령·행정규칙 카탈로그를 검색합니다.",
      inputSchema: SearchDapaCatalogSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      textResult(
        dependencies.dapaCatalog.search({
          query: input.query,
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.category === undefined ? {} : { category: input.category }),
          limit: input.limit,
        }),
      ),
  )

  server.registerTool(
    "get_dapa_legal_catalog_item",
    {
      title: "방위사업청 법령 카탈로그 조회",
      description: "DAPA 공식 법령·행정규칙 카탈로그 항목을 ID로 조회합니다.",
      inputSchema: { id: z.string().min(1) },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) => {
      const item = dependencies.dapaCatalog.get(id)
      return textResult(
        item === undefined
          ? { status: "NOT_FOUND", item: null, errors: [] }
          : { status: "OK", item, errors: [] },
      )
    },
  )

  server.registerTool(
    "get_dapa_legal_content",
    {
      title: "방위사업청 법령 원문 조회",
      description: "DAPA 카탈로그 ID를 국가법령정보 문서와 연결해 실제 본문을 조회합니다.",
      inputSchema: { id: z.string().min(1) },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) => {
      const response = await getDapaLegalContent(dependencies.dapaCatalog, dependencies.law, id)
      return textResult(response, response.status === "SOURCE_UNAVAILABLE")
    },
  )

  server.registerTool(
    "dapa_catalog_status",
    {
      title: "방위사업청 법령 카탈로그 상태",
      description: "DAPA 공식 법령·행정규칙 카탈로그의 동기화 상태를 반환합니다.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => textResult(dependencies.dapaCatalog.status()),
  )

  server.registerTool(
    "source_health",
    {
      title: "공식 출처 연결 상태",
      description: "각 데이터 Provider의 설정 및 가용 상태를 반환합니다.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () =>
      textResult({
        law: dependencies.law.health(),
        dapa_info: dependencies.dapaInfo.health(),
        dapa_catalog: dependencies.dapaCatalog.status().state,
        dapa_policy: dependencies.dapaPolicy.status().state,
        public_data: "not_configured",
        news: "not_configured",
        patent: "not_configured",
        paper: "not_configured",
        internal: "disabled",
      }),
  )
}

function toToolResult(response: SearchResponse): ReturnType<typeof textResult> {
  const isError = response.status === "SOURCE_UNAVAILABLE"
  return textResult(response, isError)
}
