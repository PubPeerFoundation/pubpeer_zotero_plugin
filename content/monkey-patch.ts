declare const Zotero: any

const marker = 'PubPeerMonkeyPatched'

export function repatch(object, method, patcher) {
  object[method] = patcher(object[method])
  object[method][marker] = true
}

export function patch(object, method, patcher) {
  Zotero.debug(`${marker}: patched ${method}`)
  if (object[method][marker]) throw new Error(`${method} re-patched`)
  repatch(object, method, patcher)
}
