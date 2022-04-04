const esbuild = require('esbuild')
const rmrf = require('rimraf')

rmrf.sync('gen')

require('zotero-plugin/copy-assets')
require('zotero-plugin/rdf')
require('zotero-plugin/version')

async function build() {
  await esbuild.build({
    bundle: true,
    format: 'iife',
    target: ['firefox60'],
    entryPoints: [ 'content/pubpeer.ts' ],
    outdir: 'build/content',
    external: [ 'zotero/itemTree' ]
  })
}

build().catch(err => {
  console.log(err)
  process.exit(1)
})
