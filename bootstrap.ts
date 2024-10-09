declare const Zotero: any

import { debug } from './content/debug'

export function install() {
  debug('installed')
}
export function uninstall() {
  debug('uninstalled')
}

export async function startup({ id, version, rootURI }) {
  debug('startup')
}

export function shutdown() {
  debug('shutdown')
}

export function onMainWindowLoad({ window }) {
  debug('onMainWindowLoad')
}

export function onMainWindowUnload({ window }) {
  debug('onMainWindowUnload')
}

