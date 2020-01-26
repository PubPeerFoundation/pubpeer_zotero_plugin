declare const Zotero: IZotero
declare const Components: any

import { patch as $patch$ } from './monkey-patch'
// import { debug } from './debug'

const PPZoteroPane = new class { // tslint:disable-line:variable-name
  private selectedItem: any

  public async load() {
    document.getElementById('zotero-itemmenu').addEventListener('popupshowing', this, false)

    await Zotero.PubPeer.start()
  }

  public async unload() {
    document.getElementById('zotero-itemmenu').removeEventListener('popupshowing', this, false)
  }

  public handleEvent(event) {
    const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems()
    this.selectedItem = selectedItems.length ? selectedItems[0] : null

    if (selectedItems.length !== 1 || !this.selectedItem || !this.selectedItem.isRegularItem() || !this.selectedItem.getField('DOI')) {
      this.selectedItem = null
    }

    document.getElementById('menu-pubpeer-get-link').hidden = !this.selectedItem
  }

  public run(method, ...args) {
    this[method].apply(this, args).catch(err => Zotero.logError(`${method}: ${err}`))
  }

  public async getPubPeerLink() {
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

  let persisted
  if (Zotero.PubPeer.uninstalled && (persisted = Zotero.Prefs.get('pane.persist'))) {
    persisted = JSON.parse(persisted)
    delete persisted['zotero-items-column-pubpeer']
    Zotero.Prefs.set('pane.persist', JSON.stringify(persisted))
  }
})

window.addEventListener('load', event => {
  PPZoteroPane.load().catch(err => Zotero.logError(err))
}, false)
window.addEventListener('unload', event => {
  PPZoteroPane.unload().catch(err => Zotero.logError(err))
}, false)

export = PPZoteroPane

// otherwise this entry point won't be reloaded: https://github.com/webpack/webpack/issues/156
delete require.cache[module.id]
