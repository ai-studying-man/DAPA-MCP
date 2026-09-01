import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { loadDapaCatalogProvider } from "../providers/dapa-catalog/provider.js"
import { loadDapaInfoProvider } from "../providers/dapa-info/dapa-info-provider.js"
import { loadDapaPolicyProvider } from "../providers/dapa-policy/provider.js"
import { CitationVerifier } from "../providers/law/citation-verifier.js"
import { LawApiProvider } from "../providers/law/law-api-provider.js"
import type { LawProviderConfig } from "../providers/law/law-provider.js"
import { LawProvider } from "../providers/law/law-provider.js"
import { registerTools } from "../tools/register-tools.js"
import { DAPA_MCP_INSTRUCTIONS } from "./instructions.js"

export type ServerConfig = {
  readonly dapaInfoPath: string
  readonly dapaCatalogPath: string
  readonly dapaPolicyPath: string
  readonly law: LawProviderConfig
  readonly maxLawApiToolResponseChars: number
}

export async function createDapaServer(config: ServerConfig): Promise<McpServer> {
  const server = new McpServer(
    { name: "dapa-mcp", version: "0.1.0" },
    { instructions: DAPA_MCP_INSTRUCTIONS },
  )
  const dapaInfo = await loadDapaInfoProvider(config.dapaInfoPath)
  const dapaCatalog = await loadDapaCatalogProvider(config.dapaCatalogPath)
  const dapaPolicy = await loadDapaPolicyProvider(config.dapaPolicyPath)
  const law = new LawProvider(config.law)
  const lawApi = new LawApiProvider(config.law)
  registerTools(server, {
    law,
    lawApi,
    dapaInfo,
    dapaCatalog,
    dapaPolicy,
    citations: new CitationVerifier(law),
    maxLawApiToolResponseChars: config.maxLawApiToolResponseChars,
  })
  return server
}
