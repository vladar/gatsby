import { startRedirectListener } from "./redirects-writer"
import {
  IBuildContext,
  initialize,
  customizeSchema,
  sourceNodes,
  buildSchema,
  createPages,
  createPagesStatefully,
  extractQueries,
  writeOutRedirects,
  postBootstrap,
  rebuildSchemaWithSitePage,
} from "../services"
import { Runner, createGraphQLRunner } from "./create-graphql-runner"
import reporter from "gatsby-cli/lib/reporter"
import { globalTracer } from "opentracing"
import JestWorker from "jest-worker"
import { handleStalePageData } from "../utils/page-data"
import db from "../db"
import { store } from "../redux"
import { syncPages } from "../db/nodes-db"

const tracer = globalTracer()

export async function bootstrap(
  initialContext: Partial<IBuildContext>
): Promise<{
  gatsbyNodeGraphQLFunction: Runner
  workerPool: JestWorker
}> {
  const spanArgs = initialContext.parentSpan
    ? { childOf: initialContext.parentSpan }
    : {}

  const parentSpan = tracer.startSpan(`bootstrap`, spanArgs)

  const bootstrapContext: IBuildContext = {
    ...initialContext,
    parentSpan,
  }

  const context = {
    ...bootstrapContext,
    ...(await initialize(bootstrapContext)),
  }

  await customizeSchema(context)
  await sourceNodes(context)

  await db.saveState()

  await buildSchema(context)

  context.gatsbyNodeGraphQLFunction = createGraphQLRunner(
    context.store,
    reporter
  )

  if (!process.env.GATSBY_REPLICA) {
    // TODO: pages must be created in the "main process"
    //   and synced to replicas similar to nodes
    //   (so do not re-create pages in replicas)
    await createPages(context)

    await createPagesStatefully(context)

    store.dispatch({
      type: `SET_PROGRAM_STATUS`,
      payload: `CREATE_PAGES_FINISHED`,
    })
  } else {
    await syncPages()
  }

  await handleStalePageData()

  await rebuildSchemaWithSitePage(context)

  // FIXME: need to run static queries in the main process :/
  // if (process.env.GATSBY_REPLICA) {
  await extractQueries(context)
  // }

  await writeOutRedirects(context)

  startRedirectListener()

  await postBootstrap(context)

  parentSpan.finish()

  return {
    gatsbyNodeGraphQLFunction: context.gatsbyNodeGraphQLFunction,
    workerPool: context.workerPool,
  }
}
