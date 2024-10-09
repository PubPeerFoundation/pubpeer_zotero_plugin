import { debug } from './content/debug'

export function install() {
  debug('installed')
}
export function uninstall() {
  debug('uninstalled')
}

let chromeHandle
export async function startup({ id, version, rootURI }) {
  debug('startup', id, version)

  const aomStartup = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup)
  const manifestURI = Services.io.newURI(`${ rootURI }manifest.json`)
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    [ 'content', 'zotero-pubpeer', 'content/'                  ], 
    [ 'locale' , 'zotero-pubpeer', 'en-US'   , 'locale/en-US/' ]
  ])

  Services.scriptloader.loadSubScript(rootURI + 'pubpeer.js', { Zotero })
  await Zotero.PubPeer.startup()
}

export async function shutdown() {
  debug('shutdown')
  await Zotero.PubPeer.shutdown()
  if (chromeHandle) {
    chromeHandle.destruct()
    chromeHandle = undefined
  }
  Zotero.PubPeer = null
}

export function onMainWindowLoad({ window }) {
  debug('onMainWindowLoad')
  window.MozXULElement.insertFTLIfNeeded('pubpeer.ftl')
  Zotero.PubPeer.onMainWindowLoad(window)
}

export function onMainWindowUnload({ window }) {
  debug('onMainWindowUnload')
  Zotero.PubPeer.onMainWindowUnload(window)
}

