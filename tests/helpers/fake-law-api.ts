import { createServer, type RequestListener, type Server } from "node:http"

export type FakeLawApi = {
  readonly baseUrl: string
  readonly close: () => Promise<void>
}

export async function startFakeLawApi(handler: RequestListener): Promise<FakeLawApi> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    await closeServer(server)
    throw new Error("fake API did not bind a TCP port")
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}
