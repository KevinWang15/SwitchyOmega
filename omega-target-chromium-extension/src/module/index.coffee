require('../../aws-sdk-2.1066.0.min.js')

module.exports =
  Storage: require('./storage')
  Options: require('./options')
  ChromeTabs: require('./tabs')
  SwitchySharp: require('./switchysharp')
  ExternalApi: require('./external_api')
  WebRequestMonitor: require('./web_request_monitor')
  Inspect: require('./inspect')
  Url: require('url')
  proxy: require('./proxy')
  s3Backup: require('./s3_backup')

for name, value of require('omega-target')
  module.exports[name] ?= value
