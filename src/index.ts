#!/usr/bin/env node

import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createDapaServer } from "./server/create-server.js"
import { loadRuntimeConfig } from "./server/runtime-config.js"

async function main(): Promise<void> {
  loadDotEnv()
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const config = loadRuntimeConfig(process.env, {
    workingDirectory: process.cwd(),
    packageRoot,
  })
  const server = await createDapaServer(config.server)
  await server.connect(new StdioServerTransport())
}

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), ".env")
  if (existsSync(envPath)) process.loadEnvFile(envPath)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`DAPA MCP server failed: ${message}\n`)
  process.exitCode = 1
})
