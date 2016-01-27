const getConfig = require('hjs-webpack')

var config = getConfig({
  in: 'src/index.js',
  out: 'public',
  html: function (context) {
    return {
      'index.html': context.defaultTemplate({
        title: 'Gather exporter',
        publicPath: './'
      })
    }
  }
})

module.exports = config
