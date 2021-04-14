import { get, createServer, IncomingMessage } from "http"
import * as url from "url"
import { Readable, pipeline } from "stream"
// import { createGzip } from "zlib"
import { createHash } from "crypto"
import { getLastOffsetAsString, readBinaryLogItems } from "./nodes-db"
import { Decoder } from "msgpackr"
import { store } from "../redux"

interface ILogItem {
  key: string
  value: Buffer
  length: number
  md5: string
}

export async function replicateStore(sourceStoreURI: string): Promise<void> {
  const lastOffset = getLastOffsetAsString()
  const decoder = new Decoder()
  const ignoredNodeTypes = new Set([
    `SitePlugin`,
    `Site`,
    `SiteBuildMetadata`,
    `SitePage`,
  ])

  async function replicateActions(response: IncomingMessage): Promise<void> {
    // TODO: check that the very first item in response also fully matches last item in our log
    //   (additional validation via log overlap)
    const start = Date.now()
    let count = 0
    for await (const logItem of genLogItems(response)) {
      const { value } = logItem
      const action = decoder.decode(value)
      // @ts-ignore
      if (ignoredNodeTypes.has(action.payload.internal.type)) {
        continue
      }
      count++
      // console.log(`syncing action`, action.type, action.payload.internal.type)
      store.dispatch(action)
    }
    console.log(`Replicated ${count} actions in ${Date.now() - start}ms`)
  }

  const uri = `${sourceStoreURI}?offset=${lastOffset}`

  return new Promise(function (resolve, reject) {
    console.log(`Starting replication at ${uri}`)
    get(uri, response => {
      // TODO: retries on failure - it should resume replication just fine
      replicateActions(response).then(resolve, reject)
    })
  })
}

// HTTP transfer chunks --> to original messages
async function* genLogItems(
  response: IncomingMessage
): AsyncGenerator<ILogItem> {
  let unfinishedChunk = Buffer.allocUnsafe(0)
  for await (const chunk of response) {
    // nextMessageChunk always begins with a message but can end anywhere
    // (e.g. in the middle of a message)
    let nextMessageChunk = Buffer.concat(
      [unfinishedChunk, chunk],
      unfinishedChunk.length + chunk.length
    )
    let message = extractNextMessage(nextMessageChunk)
    while (message) {
      yield message
      nextMessageChunk = nextMessageChunk.slice(message.length)
      message = extractNextMessage(nextMessageChunk)
    }
    unfinishedChunk = nextMessageChunk
  }
  if (unfinishedChunk.length) {
    throw new Error(`Unfinished chunk still contains data`)
  }
}

function extractNextMessage(chunk: Buffer): ILogItem | void {
  if (chunk.length < 11 + 32 + 4) {
    return undefined
  }
  const key = chunk.toString(`ascii`, 0, 11)
  const md5checksum = chunk.toString(`ascii`, 11, 11 + 32)
  const dataSize = chunk.readUInt32LE(11 + 32)
  const totalMessageLength = 11 + 32 + 4 + dataSize

  if (chunk.length < totalMessageLength) {
    return undefined
  }
  const value = chunk.slice(11 + 32 + 4, totalMessageLength)
  const md5 = createHash(`md5`).update(value).digest(`hex`)

  if (md5checksum !== md5) {
    throw new Error(
      `Replication failed: checksum mismatch for key ${key} (expected: ${md5checksum}, actual: ${md5}). ` +
        `First 50 bytes of data: ` +
        value.toString(`binary`, 0, 50)
    )
  }

  return {
    key,
    md5,
    value,
    length: totalMessageLength,
  }
}

// ---------------------------------------------------
//                SERVER PART BELOW
// ---------------------------------------------------

async function* genMessages(offset): AsyncGenerator<Buffer> {
  for await (const { key, value } of readBinaryLogItems(offset)) {
    const md5 = createHash(`md5`).update(value).digest(`hex`)
    if (key.length !== 11) {
      throw new Error(
        `Unexpected length of key ${key} (expected 11 got ${key.length})`
      )
    }
    if (key === `00000000001`) {
      console.log(`KEY ${key} data length: ${value.length}`)
    }

    const dataSize = Buffer.allocUnsafe(4)
    dataSize.writeUInt32LE(value.length, 0)

    // TODO: switch to binary format for key and md5 too
    yield Buffer.concat(
      [Buffer.from(key, `ascii`), Buffer.from(md5, `ascii`), dataSize, value],
      11 + 32 + 4 + value.length
    )
  }
}

export function startReplicationServer() {
  createServer((request, response) => {
    const queryObject = url.parse(request.url ?? ``, true).query
    const offset = queryObject.offset ?? 0
    pipeline(
      Readable.from(genMessages(offset)),
      // createGzip(),
      response,
      console.error
    )
    const headers = {
      "Content-Type": `application/octet-stream`,
      // "Content-Encoding": `gzip`,
    }
    response.setHeader(`Content-Type`, `text/plain`)
    response.writeHead(200, headers)
  }).listen(8383)
}
