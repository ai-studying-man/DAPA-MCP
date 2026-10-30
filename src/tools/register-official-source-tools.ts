import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { parseCitation } from "../lib/citation/parser.js"
import type { OfficialCourtProvider } from "../providers/court/provider.js"
import { readOfficialDisclosure } from "../providers/official-disclosure.js"
import { READ_ONLY_ANNOTATIONS, textResult } from "./tool-response.js"

export const CaseNumberSchema = z
  .string()
  .trim()
  .max(40)
  .refine(
    (value) => parseCitation(`대법원 ${value}`).caseNumber !== undefined,
    "정확한 판례 사건번호가 필요합니다",
  )

export function registerOfficialSourceTools(
  server: McpServer,
  court?: OfficialCourtProvider,
): void {
  if (court !== undefined)
    server.registerTool(
      "search_official_court",
      {
        title: "대법원 공개 판결문 원문 검색",
        description:
          "법제처 API와 별도로 대법원 공개 게시물의 첨부 판결문 PDF를 실시간 조회합니다. 게시물 제목은 판시 근거가 아니며 공개 게시물 일부만 검색합니다.",
        inputSchema: {
          query: z.string().trim().min(1).max(500),
          forceRefresh: z.boolean().default(false),
        },
        annotations: READ_ONLY_ANNOTATIONS,
      },
      async (input) => textResult(await court.search(input)),
    )
  server.registerTool(
    "read_official_case_context",
    {
      title: "공식 공시의 사건 사실관계 대조",
      description:
        "한국거래소 KIND 원문 URL과 사건번호로 해당 공시 문맥을 읽습니다. 회사 공시는 법원의 사실인정·판시와 구분해야 합니다. 임의 웹 주소는 허용하지 않습니다.",
      inputSchema: { url: z.url(), caseNumber: CaseNumberSchema },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => textResult(await readOfficialDisclosure(input)),
  )
}
