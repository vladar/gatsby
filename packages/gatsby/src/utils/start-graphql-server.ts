import { formatError, FragmentDefinitionNode, Kind } from "graphql"
import { emitter, store } from "../redux"
import graphqlHTTP from "express-graphql"
import graphqlPlayground from "graphql-playground-middleware-express"
import graphiqlExplorer from "gatsby-graphiql-explorer"
import withResolverContext from "../schema/context"
import express from "express"

export async function startGraphQLServer({ app }) {
  /**
   * Pattern matching all endpoints with graphql or graphiql with 1 or more leading underscores
   */
  const graphqlEndpoint = `/_+graphi?ql`

  if (process.env.GATSBY_GRAPHQL_IDE === `playground`) {
    app.get(
      graphqlEndpoint,
      graphqlPlayground({
        endpoint: `/___graphql`,
      }),
      () => {}
    )
  } else {
    graphiqlExplorer(app, {
      graphqlEndpoint,
      getFragments: function getFragments(): Array<FragmentDefinitionNode> {
        const fragments: Array<FragmentDefinitionNode> = []
        for (const def of store.getState().definitions.values()) {
          if (def.def.kind === Kind.FRAGMENT_DEFINITION) {
            fragments.push(def.def)
          }
        }
        return fragments
      },
    })
  }

  app.use(
    graphqlEndpoint,
    graphqlHTTP(
      (): graphqlHTTP.OptionsData => {
        const { schema, schemaCustomization } = store.getState()

        if (!schemaCustomization.composer) {
          throw new Error(
            `A schema composer was not created in time. This is likely a gatsby bug. If you experienced this please create an issue.`
          )
        }
        return {
          schema,
          graphiql: false,
          extensions(): { [key: string]: unknown } {
            return {
              enableRefresh: process.env.ENABLE_GATSBY_REFRESH_ENDPOINT,
              refreshToken: process.env.GATSBY_REFRESH_TOKEN,
            }
          },
          context: withResolverContext({
            schema,
            schemaComposer: schemaCustomization.composer,
            context: {},
            customContext: schemaCustomization.context,
          }),
          customFormatErrorFn(err): unknown {
            return {
              ...formatError(err),
              stack: err.stack ? err.stack.split(`\n`) : [],
            }
          },
        }
      }
    )
  )

  /**
   * Refresh external data sources.
   * This behavior is disabled by default, but the ENABLE_GATSBY_REFRESH_ENDPOINT env var enables it
   * If no GATSBY_REFRESH_TOKEN env var is available, then no Authorization header is required
   **/
  const REFRESH_ENDPOINT = `/__refresh`
  const refresh = async (
    req: express.Request,
    pluginName?: string
  ): Promise<void> => {
    emitter.emit(`WEBHOOK_RECEIVED`, {
      webhookBody: req.body,
      pluginName,
    })
  }

  app.post(`${REFRESH_ENDPOINT}/:plugin_name?`, express.json(), (req, res) => {
    const pluginName = req.params[`plugin_name`]

    const enableRefresh = process.env.ENABLE_GATSBY_REFRESH_ENDPOINT
    const refreshToken = process.env.GATSBY_REFRESH_TOKEN
    const authorizedRefresh =
      !refreshToken || req.headers.authorization === refreshToken

    if (enableRefresh && authorizedRefresh) {
      refresh(req, pluginName)
      res.status(200)
      res.setHeader(`content-type`, `application/json`)
    } else {
      res.status(authorizedRefresh ? 404 : 403)
      res.json({
        error: enableRefresh
          ? `Authorization failed. Make sure you add authorization header to your refresh requests`
          : `Refresh endpoint is not enabled. Run gatsby with "ENABLE_GATSBY_REFRESH_ENDPOINT=true" environment variable set.`,
        isEnabled: !!process.env.ENABLE_GATSBY_REFRESH_ENDPOINT,
      })
    }
    res.end()
  })
}
