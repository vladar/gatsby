const GatsbyThemeComponentShadowingResolverPlugin = require(`.`)

exports.onCreateWebpackConfig = (
  { store, stage, getConfig, rules, loaders, actions },
  pluginOptions
) => {
  const { flattenedPlugins, program } = store.getState()

  actions.setWebpackConfig({
    resolve: {
      plugins: [
        new GatsbyThemeComponentShadowingResolverPlugin({
          extensions: getConfig().resolve.extensions,
          themes: flattenedPlugins.map(plugin => {
            return {
              // FIXME: plugin.pluginFilepath is set in internal-data-bridge
              //  via mutation of the "plugin" node after it was created, so not persisted in our store
              themeDir: plugin.pluginFilepath,
              themeName: plugin.name,
            }
          }),
          projectRoot: program.directory,
        }),
      ],
    },
  })
}
