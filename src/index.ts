#!/usr/bin/env node

import { resolve } from "node:path"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { createDapaServer } from "./server/create-server.js"

const EnvironmentSchema = z.object({
  LAW_API_OC: z.string().min(1).optional(),
  LAW_API_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
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
  DAPA_INFO_PATH: z.string().min(1).default("./DAPA_info"),
})

async function main(): Promise<void> {
  const environment = EnvironmentSchema.parse(process.env)
  const server = await createDapaServer({
    dapaInfoPath: resolve(process.cwd(), environment.DAPA_INFO_PATH),
    dapaCatalogPath: resolve(process.cwd(), environment.DAPA_INFO_PATH, "legal", "catalog.json"),
    dapaPolicyPath: resolve(process.cwd(), environment.DAPA_INFO_PATH, "policy", "catalog.json"),
    law: {
      ...(environment.LAW_API_OC === undefined ? {} : { apiKey: environment.LAW_API_OC }),
      timeoutMs: environment.LAW_API_TIMEOUT_MS,
      retryLimit: environment.LAW_API_RETRY_LIMIT,
      cacheTtlMs: environment.LAW_API_CACHE_TTL_MS,
      maxTextResponseBytes: environment.LAW_API_MAX_TEXT_RESPONSE_BYTES,
      maxResourceResponseBytes: environment.LAW_API_MAX_RESOURCE_RESPONSE_BYTES,
    },
    maxLawApiToolResponseChars: environment.LAW_API_MAX_TOOL_RESPONSE_CHARS,
  })
  await server.connect(new StdioServerTransport())
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`DAPA MCP server failed: ${message}\n`)
  process.exitCode = 1
})
