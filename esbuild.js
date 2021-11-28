const esbuild = require('esbuild')

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
    banner: { js: 'if (!Zotero.PubPeer) {\n' },
    footer: { js: '\n}' },
    external: [ 'zotero/itemTree' ]
  })
}

build().catch(err => {
  console.log(err)
  process.exit(1)
})