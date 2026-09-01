import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { LawHttpClient } from "../src/providers/law/law-http.js"

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)))
        }),
    ),
  )
})

describe("LawHttpClient request identity", () => {
  it("sends default official-site identity headers", async () => {
    let receivedReferer: string | undefined
    let receivedUserAgent: string | undefined
    const server = createServer((request, response) => {
      receivedReferer = request.headers.referer
      receivedUserAgent = request.headers["user-agent"]
      response.writeHead(200, { "content-type": "application/json" })
      response.end("{}")
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("TCP address expected")
    const port = (address satisfies AddressInfo).port
    const client = new LawHttpClient({
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 1_000,
      retryLimit: 0,
      maxTextResponseBytes: 1_024,
      maxResourceResponseBytes: 1_024,
    })

    await client.get("lawSearch.do", { query: "방위사업" })

    expect(receivedReferer).toBe("https://www.law.go.kr/")
    expect(receivedUserAgent).toContain("dapa-mcp")
  })
})
