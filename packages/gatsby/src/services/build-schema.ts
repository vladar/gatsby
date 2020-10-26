import {
  buildSchema as buildGraphQLSchema,
  findBreakingChanges,
  GraphQLSchema,
  printSchema,
} from "graphql"
import { cloneDeep } from "lodash"
import { build, rebuild } from "../schema"
import reporter from "gatsby-cli/lib/reporter"
import { IDataLayerContext } from "../state-machines/data-layer/types"
import { IGatsbyState } from "../redux/types"
import { haveEqualFields } from "../schema/infer/inference-metadata"
import { assertStore } from "../utils/assert-store"
import { emitter, store } from "../redux"

type InferenceMetadata = IGatsbyState["inferenceMetadata"]

let lastMetadata: InferenceMetadata

emitter.on(`SET_SCHEMA`, () => {
  const { inferenceMetadata } = store.getState()
  setTimeout(() => {
    lastMetadata = cloneDeep(inferenceMetadata)
  }, 0)
})

emitter.on(`CREATE_NODE`, action => {
  if (lastMetadata) {
    const node = action.payload
    console.log(action.type, node.internal.type, node.id)
  }
})

emitter.on(`DELETE_NODE`, action => {
  if (lastMetadata) {
    const node = action.payload
    console.log(action.type, node.internal.type, node.id)
  }
})

export async function buildSchema({
  store,
  parentSpan,
  refresh,
}: Partial<IDataLayerContext>): Promise<void> {
  if (
    refresh &&
    Boolean(process.env.GATSBY_EXPERIMENTAL_DISABLE_SCHEMA_REBUILD)
  ) {
    return
  }
  assertStore(store)

  const schemaBefore = store.getState().schema

  const activity = reporter.activityTimer(`building schema`, {
    parentSpan,
  })
  activity.start()
  await build({ parentSpan: activity.span })
  activity.end()

  const { inferenceMetadata } = store.getState()

  const typesChanged = Object.keys(inferenceMetadata.typeMap).filter(
    type =>
      // inferenceMetadata.typeMap[type].dirty &&
      inferenceMetadata &&
      lastMetadata &&
      !haveEqualFields(
        inferenceMetadata.typeMap[type],
        lastMetadata.typeMap[type]
      )
  )

  const changed = typesChanged.length > 0

  console.log(`types changed:`, typesChanged)

  if (!changed && lastMetadata) {
    console.log(
      `New:`,
      inferenceMetadata.typeMap.MarkdownRemark.fieldMap!.frontmatter!.object!
        .dprops
    )
    console.log(
      `Old:`,
      lastMetadata.typeMap.MarkdownRemark.fieldMap!.frontmatter!.object!.dprops
    )
  }

  if (changed) {
    const printedOld = printSchema(schemaBefore)
    const lastSchema = buildGraphQLSchema(printedOld)

    const printedNew = printSchema(store.getState().schema)
    const newSchema = buildGraphQLSchema(printedNew)

    const breakingChanges = findBreakingChanges(lastSchema, newSchema)
    console.log(breakingChanges)
  }
}
