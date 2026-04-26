const path = require('path')

module.exports = {
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      fabric$: path.resolve(
        __dirname,
        'renderer/shared/vendor/fabric-compat.js'
      ),
    }

    return config
  },
}
