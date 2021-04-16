import { ArrayLikeIterable, Database, open, RootDatabase } from "lmdb-store"
import { ActionsUnion, ICreatePageAction, IGatsbyNode } from "../redux/types"
import { store } from "../redux"
import { performance } from "perf_hooks"

type LogOffset = number

interface IDatabases {
  actionLog: Database<ActionsUnion, LogOffset>
  nodes: Database<LogOffset, string>
  nodesByType: Database<string, string>
  staticQueriesByTemplate: Database<Array<string>, string>
  metadata: Database<string, string>
  pages: Database<ICreatePageAction, string>
}

const rootDbFile =
  process.env.NODE_ENV === `test`
    ? `test${process.env.JEST_WORKER_ID}`
    : `nodes`
let rootDb
let databases

function getRootDb(): RootDatabase {
  if (!rootDb) {
    const readOnly = Boolean(process.env.GATSBY_REPLICA)
    rootDb = open({
      name: `root`,
      path: process.cwd() + `/.data/` + rootDbFile,
      compression: true,
      sharedStructuresKey: Symbol.for(`structures`),
      // commitDelay: 100,
      maxDbs: 12,
      noSync: true, // FIXME: remove this when switching to batched writes
      readOnly,
      // FIXME: `create: true` by default; but it fails with replica
      // @ts-ignore
      create: !readOnly,
    })
  }
  return rootDb
}

function getDatabases(): IDatabases {
  if (!databases) {
    const rootDb = getRootDb()
    const readOnly = Boolean(process.env.GATSBY_REPLICA)
    databases = {
      actionLog: rootDb.openDB({
        name: `actionLog`,
        cache: true,
        keyIsUint32: true,
        // @ts-ignore
        readOnly,
        create: !readOnly,
      }),
      nodes: rootDb.openDB({
        name: `nodes`,
        // cache: true,
        // @ts-ignore
        readOnly,
        create: !readOnly,
      }),
      // dupSort allows putting multiple values to a key
      // @ts-ignore
      nodesByType: rootDb.openDB({
        name: `nodesByType`,
        // @ts-ignore
        dupSort: true,
        // @ts-ignore
        readOnly,
        create: !readOnly,
      }),
      staticQueriesByTemplate: rootDb.openDB({
        name: `staticQueriesByTemplate`,
        // @ts-ignore
        readOnly,
        create: !readOnly,
      }),
      metadata: rootDb.openDB({
        name: `metadata`,
        // @ts-ignore
        readOnly,
        create: !readOnly,
      }),
      pages: rootDb.openDB({
        name: `pages`,
        // @ts-ignore
        readOnly,
        create: !readOnly,
      }),
    }
  }
  return databases
}

/**
 * Backwards compatible getNodes() implementation
 * TODO: deprecate (or at least return ArrayLikeIterator)
 */
export function getNodes(
  asArray: boolean = true
): Array<IGatsbyNode> | ArrayLikeIterable<IGatsbyNode> {
  // Additionally fetching items by id to leverage lmdb-store cache
  const start = performance.now()
  const nodesDb = getDatabases().nodes
  const nodesIterable = nodesDb
    .getKeys({ snapshot: false })
    .map(id => getNode(id))
    .filter(Boolean)
  if (asArray) {
    const result = Array.from(nodesIterable) as Array<IGatsbyNode>

    // @ts-ignore
    const count = nodesDb.getStats().entryCount
    const timeTotal = performance.now() - start
    console.warn(
      `getNodes() is deprecated; length: ${result.length}; time(ms): ${timeTotal}, ${count}`
    )
    return result
  }
  return nodesIterable as ArrayLikeIterable<IGatsbyNode>
}

export function getNodesByType(type: string): Array<IGatsbyNode> {
  // TODO: deprecate
  const nodesByType = getDatabases().nodesByType
  const nodesIterable = nodesByType
    .getValues(type)
    .map(nodeId => getNode(nodeId))
    .filter(Boolean)

  return Array.from(nodesIterable as ArrayLikeIterable<IGatsbyNode>)
}

export function getNode(id: string): IGatsbyNode | undefined {
  if (!id) return undefined
  const { nodes, actionLog } = getDatabases()
  const logOffset = nodes.get(id)

  if (!logOffset) {
    return undefined
  }
  if (typeof logOffset !== `number`) {
    console.log(id, typeof logOffset, logOffset)
    throw new Error(`Oops!`)
  }
  // @ts-ignore
  const logEntry = actionLog.get(logOffset)
  // @ts-ignore
  if (!logEntry) {
    console.warn(`No log entry: `, logOffset)
    return undefined
    // throw new Error(`Ooops`)
  }
  // @ts-ignore
  return logEntry.payload
}

export function getTypes(): Array<string> {
  return getDatabases().nodesByType.getKeys({}).asArray
}

let binaryLog
export function getReadonlyBinaryLog(): Database<Buffer, LogOffset> {
  // This is supposed to be called from the other process
  // (it is highly not recommended to open the same db twice from the same process)
  if (!binaryLog && rootDb) {
    throw new Error(
      `Cannot open action log in binary format. Root database is already opened.`
    )
  }
  if (!binaryLog) {
    // The same actionLog but opened with `binary` encoding to read raw messages
    // @ts-ignore
    binaryLog = getRootDb().openDB({
      name: `actionLog`,
      encoding: `binary`,
      // cache: true,
      keyIsUint32: true,
      // @ts-ignore
      readOnly: true,
    })
  }
  return binaryLog
}

export function readBinaryLogItems(
  offset: number
): ArrayLikeIterable<{ key: LogOffset; value: Buffer }> {
  return getReadonlyBinaryLog().getRange({
    start: offset,
    snapshot: false,
  })
}

let lastOperationPromise: Promise<any> = Promise.resolve()
let writeTime = 0
const isReplica = process.env.GATSBY_REPLICA

export function updateNodesDb(action: ActionsUnion): void {
  if (isReplica) {
    return
  }
  switch (action.type) {
    case `DELETE_CACHE`: {
      const dbs = getDatabases()
      dbs.actionLog.clear()
      dbs.nodes.clear()
      dbs.nodesByType.clear()
      dbs.pages.clear()
      dbs.staticQueriesByTemplate.clear()
      dbs.metadata.clear()
      // Issue a transaction to make sure changes are commited
      dbs.nodes.transaction(() => {
        dbs.nodes.removeSync(``)
      })
      break
    }
    case `CREATE_NODE`:
    case `ADD_FIELD_TO_NODE`:
    case `ADD_CHILD_NODE_TO_PARENT_NODE`: {
      const { actionLog, nodes, nodesByType } = getDatabases()
      const writeStart = performance.now()

      // Transaction will commit changes to disk immediately.
      // This is highly inefficient as our transactions are too small.
      // The only reason why use transactions here is to mimic sync behavior of redux.
      // TODO: Ideally we want to just run `put` without explicit transaction
      //  and let lmdb-store to batch them and commit in a single transaction when necessary.
      //  It is easy to do - we just need to await the promise of the last operation (`put`, `remove`)
      //  before finishing sourcing (and on any stateful source node)
      // getRootDb().transaction(() => {
      // nodesByType db uses dupSort, so `put` will effectively append an id
      const time = logicalClockTick()
      // @ts-ignore
      nodesByType.put(action.payload.internal.type, action.payload.id)
      try {
        // @ts-ignore
        const { pluginOptions, ...other } = action.plugin || {}
        actionLog.put(time, {
          type: action.type,
          // @ts-ignore
          payload: action.payload,
          // @ts-ignore
          plugin: other,
        })
        lastOperationPromise = nodes.put(action.payload.id, time)
      } catch (e) {
        console.log(`FAIL!`, action, e)
        throw e
      }
      // })
      writeTime += performance.now() - writeStart
      break
    }
    case `DELETE_NODE`: {
      if (action.payload) {
        const { actionLog, nodes, nodesByType } = getDatabases()
        const payload = action.payload
        // getRootDb().transaction(() => {
        const time = logicalClockTick()
        nodesByType.remove(payload.internal.type, payload.id)
        actionLog.put(time, action)
        lastOperationPromise = nodes.remove(payload.id)
        // })
      }
      break
    }
    case `CREATE_PAGE`: {
      const { pages } = getDatabases()
      pages.putSync(action.payload.path, {
        type: `CREATE_PAGE`,
        plugin: action.plugin,
        payload: action.payload,
        contextModified: action.contextModified,
      })
      break
    }

    case `DELETE_PAGE`: {
      const { pages } = getDatabases()
      pages.removeSync(action.payload.path)
      break
    }

    case `SET_PROGRAM`: {
      const { metadata } = getDatabases()
      metadata.putSync(`storeState`, `STARTED`)
      break
    }

    case `SET_STATIC_QUERIES_BY_TEMPLATE`: {
      const { staticQueriesByTemplate } = getDatabases()
      staticQueriesByTemplate.put(
        action.payload.componentPath,
        action.payload.staticQueryHashes
      )
      break
    }

    case `SET_PROGRAM_STATUS`: {
      // @ts-ignore
      if (action.payload === `SOURCING_FINISHED`) {
        const { metadata } = getDatabases()
        metadata.putSync(`storeState`, `READY`)
      }
      if (action.payload === `BOOTSTRAP_FINISHED`) {
        console.log(`Node write time: `, writeTime)
        const stats = getDatabases().nodes.getStats()
        console.log(`Nodes stats: `, stats)
      }
      // @ts-ignore
      if (action.payload === `WEBPACK_FINISHED`) {
        const { metadata } = getDatabases()
        metadata.putSync(`webpackState`, `READY`)
      }
      // @ts-ignore
      if (action.payload === `CREATE_PAGES_FINISHED`) {
        const { metadata } = getDatabases()
        metadata.putSync(`createPagesState`, `READY`)
      }
      break
    }
    default:
  }
}

let time
function logicalClockTick(): number {
  if (!time) {
    time = getLastLogOffset()
  }
  time++
  return time
}

export function getLastLogOffset(): number {
  return (
    Number(
      getDatabases().actionLog.getKeys({ reverse: true, limit: 1 }).asArray[0]
    ) || 0
  )
}

export async function waitDbCommit(): Promise<void> {
  await lastOperationPromise
}

export function getProgramState(stateKey: string): string {
  try {
    return getDatabases().metadata.get(stateKey) ?? `PENDING`
  } catch (e) {
    console.warn(e.message)
    return `WAITING`
  }
}

export function getStoreState(): string {
  return getProgramState(`storeState`)
}

export function getWebpackState(): string {
  return getProgramState(`storeState`)
}

export function getCreatePagesState(): string {
  return getProgramState(`createPagesState`)
}

export async function programIsReady(stateKey: string): Promise<void> {
  if (!process.env.GATSBY_REPLICA) {
    throw new Error(`Only allowed for replicas`)
  }
  function checkIfReady(resolve): void {
    const state = getProgramState(stateKey)
    console.log(`[${process.env.GATSBY_REPLICA}] ${stateKey}: ${state}`)
    if (state === `READY`) {
      resolve()
    } else {
      setTimeout(() => checkIfReady(resolve), 1000)
    }
  }

  return new Promise(checkIfReady)
}

async function storeIsReady(): Promise<void> {
  return programIsReady(`storeState`)
}

async function webpackCompiled(): Promise<void> {
  return programIsReady(`webpackState`)
}

async function pagesCreated(): Promise<void> {
  return programIsReady(`createPagesState`)
}

export async function syncWebpackArtifacts(): Promise<void> {
  await webpackCompiled()

  console.log(`Syncing webpack artifacts!`)

  const { staticQueriesByTemplate } = getDatabases()

  staticQueriesByTemplate.getRange({}).forEach(({ key, value }) => {
    const action = {
      type: `SET_STATIC_QUERIES_BY_TEMPLATE`,
      payload: {
        componentPath: key,
        staticQueryHashes: value,
      },
    }
    store.dispatch(action)
  })
}

export async function syncNodes(): Promise<void> {
  await storeIsReady()

  console.log(`Syncing nodes!`)

  // const { actionLog } = getDatabases()
  // console.log(`actionLog traversal`)
  // console.log(``)
  // actionLog.getRange({ snapshot: false }).forEach(({ key, value }) => {
  //   console.log(key, value)
  // })
  // console.log(``)
  // process.exit(1)

  // Other reducers in replica expect this
  let count = 0
  getNodes(false).forEach(node => {
    count++
    store.dispatch({
      type: `CREATE_NODE`,
      payload: node,
    })
  })
  console.log(`Synced ${count} nodes.`)
}

export async function syncPages(): Promise<void> {
  await pagesCreated()

  console.log(`Syncing pages!`)

  const { pages } = getDatabases()

  let count = 0
  let badCount = 0
  pages.getRange({ snapshot: false }).forEach(({ value: action }) => {
    if (!action || !action.type) {
      if (badCount++ < 2) {
        console.log(`Bad action:`, action)
      }
    } else {
      // TODO: just store payload, run CREATE_PAGE action here
      count++
      store.dispatch({ ...action })
    }
  })

  console.log(`Synced ${count} pages. Got ${badCount} actions.`)
}
