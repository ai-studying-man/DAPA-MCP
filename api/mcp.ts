import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  createDapaServer,
  type DapaServerDependencies,
  loadDapaServerDependencies,
} from "../src/server/create-server.js"
import { loadRuntimeConfig } from "../src/server/runtime-config.js"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "MCP-Session-Id, MCP-Protocol-Version",
} as const

type HandlerOptions = {
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly workingDirectory: string
  readonly packageRoot: string
}

type McpHttpHandler = (request: Request) => Promise<Response>

type ParsedBodyResult =
  | { readonly status: "ok"; readonly body: unknown }
  | { readonly status: "invalid_json" }
  | { readonly status: "too_large" }

export function createMcpHttpHandler(options: HandlerOptions): McpHttpHandler {
  const runtime = loadRuntimeConfig(options.environment, {
    workingDirectory: options.workingDirectory,
    packageRoot: options.packageRoot,
  })
  let dependencies: Promise<DapaServerDependencies> | undefined

  return async (request) => {
    try {
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }))
      }

      const parsedBody = await parseBody(request, runtime.maxMcpRequestBytes)
      if (parsedBody.status === "too_large") {
        return withCors(jsonRpcError(413, -32000, "Request body is too large"))
      }
      if (parsedBody.status === "invalid_json") {
        return withCors(jsonRpcError(400, -32700, "Parse error"))
      }

      dependencies ??= loadDapaServerDependencies(runtime.server)
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
      const server = await createDapaServer(runtime.server, await dependencies)
      try {
        await server.connect(transport)
        const response = await transport.handleRequest(
          request,
          parsedBody.status === "ok" ? { parsedBody: parsedBody.body } : undefined,
        )
        return withCors(response)
      } finally {
        await server.close()
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError"
      process.stderr.write(`DAPA MCP HTTP request failed: ${errorName}\n`)
      return withCors(jsonRpcError(500, -32603, "Internal server error"))
    }
  }
}

async function parseBody(request: Request, maxBytes: number): Promise<ParsedBodyResult> {
  if (request.method !== "POST") return { status: "ok", body: undefined }
  const declaredLength = Number(request.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { status: "too_large" }
  }
  if (request.body === null) return { status: "invalid_json" }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    totalBytes += result.value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel()
      return { status: "too_large" }
    }
    chunks.push(result.value)
  }

  const combined = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { status: "ok", body: JSON.parse(new TextDecoder().decode(combined)) }
  } catch {
    return { status: "invalid_json" }
  }
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers: { "Cache-Control": "no-store" } },
  )
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value)
  headers.set("Cache-Control", "no-store")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
let productionHandler: McpHttpHandler | undefined

function handleProductionRequest(request: Request): Promise<Response> {
  productionHandler ??= createMcpHttpHandler({
    environment: process.env,
    workingDirectory: process.cwd(),
    packageRoot,
  })
  return productionHandler(request)
}

export function GET(request: Request): Promise<Response> {
  return handleProductionRequest(request)
}

export function POST(request: Request): Promise<Response> {
  return handleProductionRequest(request)
}

export function DELETE(request: Request): Promise<Response> {
  return handleProductionRequest(request)
}

export function OPTIONS(request: Request): Promise<Response> {
  return handleProductionRequest(request)
}
