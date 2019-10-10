declare const Zotero: any
declare const Components: any

import { PubPeer } from './pubpeer'

const PPZoteroPane = new class { // tslint:disable-line:variable-name
  private initialized: boolean = false
  private selectedItem: any

  public async load() {
    if (!this.initialized) {
      this.initialized = true
    }

    document.getElementById('zotero-itemmenu').addEventListener('popupshowing', this, false)
  }

  public async unload() {
    document.getElementById('zotero-itemmenu').removeEventListener('popupshowing', this, false)
  }

  public handleEvent(event) {
    Zotero.debug(event)

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

    const feedback = (await PubPeer.get([ doi ]))[0]
    if (feedback) {
      let output = `The selected item has ${feedback.total_comments} ${feedback.total_comments === 1 ? 'comment' : 'comments'} on PubPeer`
      if (feedback.total_comments) output += ` ${feedback.url}`
      alert(output)
    }
  }
}

window.addEventListener('load', event => {
  PPZoteroPane.load().catch(err => Zotero.logError(err))
}, false)
window.addEventListener('unload', event => {
  PPZoteroPane.unload().catch(err => Zotero.logError(err))
}, false)

export = PPZoteroPane

// otherwise this entry point won't be reloaded: https://github.com/webpack/webpack/issues/156
delete require.cache[module.id]
