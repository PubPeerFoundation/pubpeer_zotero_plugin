import { log } from './content/debug'

export function install() {
  log.debug('installed')
}
export function uninstall() {
  log.debug('uninstalled')
}

let chromeHandle
export async function startup({ id, version, rootURI }) {
  log.debug('startup', id, version)

  const aomStartup = Components.classes['@mozilla.org/addons/addon-manager-startup;1'].getService(Components.interfaces.amIAddonManagerStartup)
  const manifestURI = Services.io.newURI(`${ rootURI }manifest.json`)
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    [ 'content', 'zotero-pubpeer', 'content/'                  ], 
    [ 'locale' , 'zotero-pubpeer', 'en-US'   , 'locale/en-US/' ]
  ])

  Services.scriptloader.loadSubScript(`${rootURI}pubpeer.js`, { rootURI, Zotero })
  await Zotero.PubPeer.startup()
}

export async function shutdown() {
  log.debug('shutdown')
  await Zotero.PubPeer.shutdown()
  if (chromeHandle) {
    chromeHandle.destruct()
    chromeHandle = undefined
  }
  Zotero.PubPeer = null
}

export function onMainWindowLoad({ window }) {
  log.debug('onMainWindowLoad')
  window.MozXULElement.insertFTLIfNeeded('pubpeer.ftl')
  Zotero.PubPeer?.onMainWindowLoad(window)
}

export function onMainWindowUnload({ window }) {
  log.debug('onMainWindowUnload')
  Zotero.PubPeer?.onMainWindowUnload(window)
}

