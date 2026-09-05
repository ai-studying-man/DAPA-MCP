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
  readonly legalContentSearchBudgetMs: number
}

export type DapaServerDependencies = {
  readonly law: LawProvider
  readonly lawApi: LawApiProvider
  readonly dapaInfo: Awaited<ReturnType<typeof loadDapaInfoProvider>>
  readonly dapaCatalog: Awaited<ReturnType<typeof loadDapaCatalogProvider>>
  readonly dapaPolicy: Awaited<ReturnType<typeof loadDapaPolicyProvider>>
  readonly citations: CitationVerifier
  readonly maxLawApiToolResponseChars: number
  readonly legalContentSearchBudgetMs: number
}

export async function loadDapaServerDependencies(
  config: ServerConfig,
): Promise<DapaServerDependencies> {
  const dapaInfo = await loadDapaInfoProvider(config.dapaInfoPath)
  const dapaCatalog = await loadDapaCatalogProvider(config.dapaCatalogPath)
  const dapaPolicy = await loadDapaPolicyProvider(config.dapaPolicyPath)
  const law = new LawProvider(config.law)
  return {
    law,
    lawApi: new LawApiProvider(config.law),
    dapaInfo,
    dapaCatalog,
    dapaPolicy,
    citations: new CitationVerifier(law),
    maxLawApiToolResponseChars: config.maxLawApiToolResponseChars,
    legalContentSearchBudgetMs: config.legalContentSearchBudgetMs,
  }
}

export async function createDapaServer(
  config: ServerConfig,
  dependencies?: DapaServerDependencies,
): Promise<McpServer> {
  const server = new McpServer(
    { name: "dapa-mcp", version: "0.1.0" },
    { instructions: DAPA_MCP_INSTRUCTIONS },
  )
  registerTools(server, dependencies ?? (await loadDapaServerDependencies(config)))
  return server
}
