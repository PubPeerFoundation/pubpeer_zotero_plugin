declare const Zotero: IZotero

export function debug(...msg) {
  const str = `PubPeer: ${msg.map(s => s.toString()).join(' ')}`
  // console.error(str) // tslint:disable-line:no-console
  Zotero.debug(str)
}
