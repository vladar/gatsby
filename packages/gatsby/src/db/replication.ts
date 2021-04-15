import { get, createServer, IncomingMessage } from "http"
import * as url from "url"
import { Readable, pipeline } from "stream"
// import { createGzip } from "zlib"
import { createHash } from "crypto"
import { getLastLogOffset, readBinaryLogItems } from "./nodes-db"
import { Decoder } from "msgpackr"
import { store } from "../redux"

interface ILogItem {
  key: number
  value: Buffer
  length: number
  md5: string
}

export async function replicateStore(sourceStoreURI: string): Promise<void> {
  const lastOffset = getLastLogOffset()
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
    let size = 0
    for await (const logItem of genLogItems(response)) {
      const { value, length } = logItem
      const action = decoder.decode(value)
      // @ts-ignore
      if (ignoredNodeTypes.has(action.payload.internal.type)) {
        continue
      }
      count++
      size += length
      // console.log(`syncing action`, action.type, action.payload.internal.type)
      store.dispatch(action)
    }
    console.log(
      `Synced ${count} actions in ${Date.now() - start}ms; ` +
        `total size: ${(size / (1024 * 1024)).toFixed(2)}MB`
    )
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
  if (chunk.length < 4 + 32 + 4) {
    return undefined
  }
  const key = chunk.readUInt32LE(0)
  const md5checksum = chunk.toString(`ascii`, 4, 4 + 32)
  const dataSize = chunk.readUInt32LE(4 + 32)
  const totalMessageLength = 4 + 32 + 4 + dataSize

  if (chunk.length < totalMessageLength) {
    return undefined
  }
  const value = chunk.slice(4 + 32 + 4, totalMessageLength)
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
async function* genMessages(offset: number): AsyncGenerator<Buffer> {
  console.log(`Starting sync from offset: ${offset}`)
  let generatedBytes = 0
  let avgActionSize = 0
  let totalActionCount = 0
  let lastOffset = offset
  const start = Date.now()

  const report = (): string =>
    `Synced ${totalActionCount} actions from ${offset} to ${lastOffset} ` +
    `in ${((Date.now() - start) / 1000).toFixed(2)} seconds.\n` +
    `Total size: ${(generatedBytes / (1024 * 1024)).toFixed(2)}MB; ` +
    `avg action size: ${avgActionSize.toFixed(0)} bytes`

  for await (const { key, value } of readBinaryLogItems(offset)) {
    const md5 = createHash(`md5`).update(value).digest(`hex`)
    if (typeof key !== `number`) {
      throw new Error(
        `Unexpected key ${key} tye (expected number got ${typeof key})`
      )
    }

    const keyBuf = Buffer.allocUnsafe(4)
    keyBuf.writeUInt32LE(key, 0)

    const dataSizeBuf = Buffer.allocUnsafe(4)
    dataSizeBuf.writeUInt32LE(value.length, 0)

    // TODO: switch to binary format for md5 too
    const totalBufferLength = 4 + 32 + 4 + value.length
    totalActionCount++
    generatedBytes += totalBufferLength
    avgActionSize = generatedBytes / totalActionCount
    lastOffset = key

    yield Buffer.concat(
      [keyBuf, Buffer.from(md5, `ascii`), dataSizeBuf, value],
      totalBufferLength
    )
    if (key % 100000 === 0) {
      console.log(report())
    }
  }
  console.log(`Done! ${report()}`)
  console.log(``)
}

export function startReplicationServer() {
  createServer((request, response) => {
    const queryObject = url.parse(request.url ?? ``, true).query
    const offset = Number(queryObject.offset) || 0
    pipeline(
      Readable.from(genMessages(offset)),
      // createGzip(),
      response,
      err => (err ? console.error(err) : undefined)
    )
    const headers = {
      "Content-Type": `application/octet-stream`,
      // "Content-Encoding": `gzip`,
    }
    response.writeHead(200, headers)
  }).listen(8383)
}
