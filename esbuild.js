/* eslint-disable */
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')
const rmrf = require('rimraf')

rmrf.sync('gen')

require('zotero-plugin/copy-assets')
require('zotero-plugin/rdf')
require('zotero-plugin/version')

async function bundle() {
  const outdir = 'build'
  const entry = 'bootstrap.ts'
  const config = {
    entryPoints: [ entry ],
    outdir,
    bundle: true,
    format: 'iife',
    target: ['firefox60'],
    treeShaking: true,
    minify: false,
    drop: ['console'],
    external: [ 'zotero/itemTree' ]
  }

  const target = path.join(outdir, entry.replace(/[.]ts$/, '.js'))
  const esm = await esbuild.build({ ...config, logLevel: 'silent', format: 'esm', metafile: true, write: false })
  let globalName
  for (const output of Object.values(esm.metafile.outputs)) {
    if (output.entryPoint) {
      const sep = '$$'
      config.globalName = escape(`{ ${output.exports.sort().join(', ')} }`).replace(/%/g, '$')
    }
  }

  await esbuild.build(config)

  await fs.promises.writeFile(
    target,
    (await fs.promises.readFile(target, 'utf-8')).replace(config.globalName, unescape(config.globalName.replace(/[$]/g, '%')))
  )
}

bundle().catch(err => {
  console.log(err)
  process.exit(1)
})
