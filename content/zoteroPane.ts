declare const Zotero: IZotero

import { patch as $patch$ } from './monkey-patch'
// import { debug } from './debug'

const loaded: { document: HTMLDocument } = { document: null }

export class ZoteroPane {
  private selectedItem: any

  public async load(globals: any): Promise<void> {
    loaded.document = globals.document

    loaded.document.getElementById('zotero-itemmenu').addEventListener('popupshowing', this, false)

    await Zotero.PubPeer.start()
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async unload(): Promise<void> { // async because of generic setup in the xul script
    loaded.document.getElementById('zotero-itemmenu').removeEventListener('popupshowing', this, false)
  }

  public handleEvent(_event: any): void {
    const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems()
    this.selectedItem = selectedItems.length ? selectedItems[0] : null

    if (selectedItems.length !== 1 || !this.selectedItem || !this.selectedItem.isRegularItem() || !this.selectedItem.getField('DOI')) {
      this.selectedItem = null
    }

    loaded.document.getElementById('menu-pubpeer-get-link').hidden = !this.selectedItem
  }

  public run(method: string, ...args): void {
    this[method].apply(this, args).catch(err => Zotero.logError(`${method}: ${err}`)) // eslint-disable-line prefer-spread
  }

  public async getPubPeerLink(): Promise<void> {
    const doi = this.selectedItem ? this.selectedItem.getField('DOI') : ''
    if (!doi) return

    const feedback = (await Zotero.PubPeer.get([ doi ]))[0]
    if (feedback) {
      let output = `The selected item has ${feedback.total_comments} ${feedback.total_comments === 1 ? 'comment' : 'comments'} on PubPeer`
      if (feedback.total_comments) output += ` ${feedback.url}`
      alert(output)
    }
  }
}

// Monkey patch because of https://groups.google.com/forum/#!topic/zotero-dev/zy2fSO1b0aQ
$patch$(Zotero.getActiveZoteroPane(), 'serializePersist', original => function() {
  original.apply(this, arguments)

  let persisted: any
  if (Zotero.PubPeer.uninstalled && (persisted = Zotero.Prefs.get('pane.persist'))) {
    persisted = JSON.parse(persisted)
    delete persisted['zotero-items-column-pubpeer']
    Zotero.Prefs.set('pane.persist', JSON.stringify(persisted))
  }
})
