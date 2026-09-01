import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import type { ServerConfig } from "./create-server.js"

const EnvironmentSchema = z.object({
  LAW_API_OC: z.string().min(1).default("dusgh4847"),
  LAW_API_TIMEOUT_MS: z.coerce.number().int().positive().default(55_000),
  LAW_API_RETRY_LIMIT: z.coerce.number().int().min(0).max(5).default(2),
  LAW_API_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(300_000),
  LAW_API_MAX_TEXT_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(64 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  LAW_API_MAX_RESOURCE_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(100 * 1024 * 1024)
    .default(25 * 1024 * 1024),
  LAW_API_MAX_TOOL_RESPONSE_CHARS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(2_000_000)
    .default(250_000),
  LAW_API_REFERER: z.url().default("https://www.law.go.kr/"),
  LAW_API_USER_AGENT: z
    .string()
    .min(1)
    .default("dapa-mcp/0.1 (+https://github.com/ai-studying-man/DAPA-MCP)"),
  MCP_MAX_REQUEST_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(4 * 1024 * 1024)
    .default(1024 * 1024),
  DAPA_INFO_PATH: z.string().min(1).default("./DAPA_info"),
})

export type RuntimePaths = {
  readonly workingDirectory: string
  readonly packageRoot: string
}

export type RuntimeConfig = {
  readonly server: ServerConfig
  readonly maxMcpRequestBytes: number
}

export function loadRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
  paths: RuntimePaths,
): RuntimeConfig {
  const parsed = EnvironmentSchema.parse(
    Object.fromEntries(
      Object.entries(environment).map(([key, value]) => [
        key,
        value?.trim() === "" ? undefined : value,
      ]),
    ),
  )
  const dapaInfoPath = resolveDapaInfoPath(parsed.DAPA_INFO_PATH, paths)
  return {
    server: {
      dapaInfoPath,
      dapaCatalogPath: resolve(dapaInfoPath, "legal", "catalog.json"),
      dapaPolicyPath: resolve(dapaInfoPath, "policy", "catalog.json"),
      law: {
        apiKey: parsed.LAW_API_OC,
        timeoutMs: parsed.LAW_API_TIMEOUT_MS,
        retryLimit: parsed.LAW_API_RETRY_LIMIT,
        cacheTtlMs: parsed.LAW_API_CACHE_TTL_MS,
        maxTextResponseBytes: parsed.LAW_API_MAX_TEXT_RESPONSE_BYTES,
        maxResourceResponseBytes: parsed.LAW_API_MAX_RESOURCE_RESPONSE_BYTES,
        referer: parsed.LAW_API_REFERER,
        userAgent: parsed.LAW_API_USER_AGENT,
      },
      maxLawApiToolResponseChars: parsed.LAW_API_MAX_TOOL_RESPONSE_CHARS,
    },
    maxMcpRequestBytes: parsed.MCP_MAX_REQUEST_BYTES,
  }
}

function resolveDapaInfoPath(configuredPath: string, paths: RuntimePaths): string {
  const workingDirectoryPath = resolve(paths.workingDirectory, configuredPath)
  if (existsSync(workingDirectoryPath)) return workingDirectoryPath
  return resolve(paths.packageRoot, configuredPath)
}
