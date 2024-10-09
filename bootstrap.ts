import { debug } from './content/debug'

export function install() {
  debug('installed')
}
export function uninstall() {
  debug('uninstalled')
}

export async function startup({ id, version, rootURI }) {
  debug('startup', id, version)
  Services.scriptloader.loadSubScript(rootURI + 'pubpeer.js', { Zotero })
  await Zotero.PubPeer.startup()
}

export async function shutdown() {
  debug('shutdown')
  await Zotero.PubPeer.shutdown()
  Zotero.PubPeer = null
}

export function onMainWindowLoad({ window }) {
  debug('onMainWindowLoad')
  Zotero.PubPeer.onMainWindowLoad(window)
}

export function onMainWindowUnload({ window }) {
  debug('onMainWindowUnload')
  Zotero.PubPeer.onMainWindowUnload(window)
}

