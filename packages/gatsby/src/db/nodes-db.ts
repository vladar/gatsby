import { ArrayLikeIterable, Database, open, RootDatabase } from "lmdb-store"
import { ActionsUnion, IGatsbyNode } from "../redux/types"
import { store } from "../redux"
import { performance } from "perf_hooks"

interface IDatabases {
  nodes: Database<IGatsbyNode, string>
  nodesByType: Database<string, string>
  metadata: Database<string, string>
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
    console.log(`readOnly?`, readOnly, process.env.GATSBY_REPLICA)
    rootDb = open({
      name: `root`,
      path: process.cwd() + `/.data/` + rootDbFile,
      compression: true,
      sharedStructuresKey: Symbol.for(`structures`),
      // commitDelay: 100,
      maxDbs: 12,
      // noSync: true, // FIXME: remove this when switching to batched writes
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
      nodes: rootDb.openDB({
        name: `nodes`,
        cache: process.env.GATSBY_REPLICA ? true : false, // do not keep nodes in memory in main process
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
      metadata: rootDb.openDB({
        name: `metadata`,
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
  return getDatabases().nodes.get(id)
}

export function getTypes(): Array<string> {
  return getDatabases().nodesByType.getKeys({}).asArray
}

let lastOperationPromise: Promise<any> = Promise.resolve()
let writeTime = 0

export function updateNodesDb(action: ActionsUnion): void {
  if (process.env.GATSBY_REPLICA) {
    return
  }
  switch (action.type) {
    case `DELETE_CACHE`: {
      const { nodes, nodesByType } = getDatabases()
      nodes.clear()
      nodesByType.clear()
      // Issue a transaction to make sure changes are commited
      nodes.transaction(() => {
        nodes.removeSync(``)
      })
      break
    }
    case `CREATE_NODE`:
    case `ADD_FIELD_TO_NODE`:
    case `ADD_CHILD_NODE_TO_PARENT_NODE`: {
      const { nodes, nodesByType } = getDatabases()
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
      nodesByType.put(action.payload.internal.type, action.payload.id)
      lastOperationPromise = nodes.put(action.payload.id, action.payload)
      // })
      writeTime += performance.now() - writeStart
      break
    }
    case `DELETE_NODE`: {
      if (action.payload) {
        const { nodes, nodesByType } = getDatabases()
        const payload = action.payload
        // getRootDb().transaction(() => {
        nodesByType.remove(payload.internal.type, payload.id)
        lastOperationPromise = nodes.remove(payload.id)
        // })
      }
      break
    }
    case `SET_PROGRAM`: {
      const { metadata } = getDatabases()
      metadata.putSync(`storeState`, `STARTED`)
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
      break
    }
    default:
  }
}

export async function waitDbCommit(): Promise<void> {
  await lastOperationPromise
}

export function getStoreState(): string {
  try {
    return getDatabases().metadata.get(`storeState`) ?? `PENDING`
  } catch (e) {
    console.warn(e.message)
    return `WAITING`
  }
}

export function getWebpackState(): string {
  try {
    return getDatabases().metadata.get(`webpackState`) ?? `PENDING`
  } catch (e) {
    console.warn(e.message)
    return `WAITING`
  }
}

export async function storeIsReady(): Promise<void> {
  if (!process.env.GATSBY_REPLICA) {
    throw new Error(`Only allowed for replicas`)
  }
  function checkIfReady(resolve): void {
    const state = getStoreState()
    console.log(`[${process.env.GATSBY_REPLICA}] store: ${state}`)
    if (state === `READY`) {
      resolve()
    } else {
      setTimeout(() => checkIfReady(resolve), 1000)
    }
  }

  return new Promise(checkIfReady)
}

export async function syncNodes(): Promise<void> {
  await storeIsReady()

  // Other reducers in replica expect this
  getNodes(false).forEach(node => {
    store.dispatch({
      type: `CREATE_NODE`,
      payload: node,
    })
  })
}

export async function webpackCompiled(): Promise<void> {
  if (!process.env.GATSBY_REPLICA) {
    throw new Error(`Only allowed for replicas`)
  }
  function checkIfReady(resolve): void {
    const state = getWebpackState()
    console.log(`[${process.env.GATSBY_REPLICA}] webpack: ${state}`)
    if (state === `READY`) {
      resolve()
    } else {
      setTimeout(() => checkIfReady(resolve), 1000)
    }
  }

  return new Promise(checkIfReady)
}
