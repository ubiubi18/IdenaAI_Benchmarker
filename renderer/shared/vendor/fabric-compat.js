const fabricModule = require('../../../node_modules/fabric/dist/index.min.js')

module.exports = {
  fabric: fabricModule.fabric || fabricModule.default || fabricModule,
}
