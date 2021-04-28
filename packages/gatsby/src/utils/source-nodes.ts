import report from "gatsby-cli/lib/reporter"
import { Span } from "opentracing"
import apiRunner from "./api-runner-node"
import { store } from "../redux"
import { getNode, getNodes } from "../redux/nodes"
import { actions } from "../redux/actions"
import { IGatsbyState } from "../redux/types"
const { deleteNode } = actions
import { Node } from "../../index"
import { syncNodes, waitDbCommit } from "../db/nodes-db"
import { replicateStore } from "../db/replication"
import { ArrayLikeIterable } from "lmdb-store"

/**
 * Finds the name of all plugins which implement Gatsby APIs that
 * may create nodes, but which have not actually created any nodes.
 */
function discoverPluginsWithoutNodes(
  storeState: IGatsbyState,
  nodes: Array<Node>
): Array<string> {
  // Find out which plugins own already created nodes
  const nodeOwnerSet = new Set([`default-site-plugin`])
  nodes.forEach(node => nodeOwnerSet.add(node.internal.owner))

  return storeState.flattenedPlugins
    .filter(
      plugin =>
        // "Can generate nodes"
        plugin.nodeAPIs.includes(`sourceNodes`) &&
        // "Has not generated nodes"
        !nodeOwnerSet.has(plugin.name)
    )
    .map(plugin => plugin.name)
}

/**
 * Warn about plugins that should have created nodes but didn't.
 */
function warnForPluginsWithoutNodes(
  state: IGatsbyState,
  nodes: Array<Node>
): void {
  const pluginsWithNoNodes = discoverPluginsWithoutNodes(state, nodes)

  pluginsWithNoNodes.map(name =>
    report.warn(
      `The ${name} plugin has generated no Gatsby nodes. Do you need it?`
    )
  )
}

/**
 * Return the set of nodes for which its root node has not been touched
 */
function getStaleNodes(
  state: IGatsbyState,
  nodes: Array<Node> | ArrayLikeIterable<Node>
): Array<Node> | ArrayLikeIterable<Node> {
  return nodes.filter(node => {
    let rootNode = node
    let next: Node | undefined = undefined

    let whileCount = 0
    do {
      next = rootNode.parent ? getNode(rootNode.parent) : undefined
      if (next) {
        rootNode = next
      }
    } while (next && ++whileCount < 101)

    if (whileCount > 100) {
      console.log(
        `It looks like you have a node that's set its parent as itself`,
        rootNode
      )
    }

    return !state.nodesTouched.has(rootNode.id)
  })
}

/**
 * Find all stale nodes and delete them
 */
function deleteStaleNodes(
  state: IGatsbyState,
  nodes: Array<Node> | ArrayLikeIterable<Node>
): void {
  const staleNodes = getStaleNodes(state, nodes)

  // if (staleNodes.length > 0) {
  staleNodes.forEach(node => store.dispatch(deleteNode(node)))
  // }
}

export default async ({
  webhookBody,
  pluginName,
  parentSpan,
  deferNodeMutation = false,
}: {
  webhookBody: unknown
  pluginName?: string
  parentSpan: Span
  deferNodeMutation: boolean
}): Promise<void> => {
  if (process.env.REMOTE_STORE_URL) {
    await replicateStore(process.env.REMOTE_STORE_URL)
    // We still want to run sourcing (but limit it to internal plugins internally)
  }
  await apiRunner(`sourceNodes`, {
    traceId: `initial-sourceNodes`,
    waitForCascadingActions: true,
    deferNodeMutation,
    parentSpan,
    webhookBody: webhookBody || {},
    pluginName,
  })
  if (!process.env.GATSBY_REPLICA) {
    await waitDbCommit()
  } else {
    await syncNodes()
  }

  const state = store.getState()
  const nodes = getNodes(false)

  // FIXME: This loops through all nodes
  // warnForPluginsWithoutNodes(state, nodes)

  deleteStaleNodes(state, nodes)

  await waitDbCommit()
  store.dispatch({ type: `SET_PROGRAM_STATUS`, payload: `SOURCING_FINISHED` })
}
