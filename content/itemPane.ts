declare const Zotero: any
declare const Components: any
declare const ZoteroItemPane: any

import { patch as $patch$ } from './monkey-patch'
import { PubPeer } from './pubpeer'

const PPItemPane = new class { // tslint:disable-line:variable-name
  public item: any = null

  private observer: number = null

  private dom = {
    parser: Components.classes['@mozilla.org/xmlextras/domparser;1'].createInstance(Components.interfaces.nsIDOMParser),
    serializer: Components.classes['@mozilla.org/xmlextras/xmlserializer;1'].createInstance(Components.interfaces.nsIDOMSerializer),
  }

  public async notify(action, type, ids) {
    if (!this.item || !ids.includes(this.item.id)) return

    switch (action) {
      case 'delete':
      case 'trash':
        this.item = null
        break

      case 'add':
      case 'modify':
        break
    }

    await this.refresh()
  }

  public async load() {
    this.observer = Zotero.Notifier.registerObserver(this, ['item'], 'PubPeer')
  }

  public async unload() {
    Zotero.Notifier.unregisterObserver(this.observer)
  }

  public async refresh() {
    const doi = this.item?.getField('DOI')

    // const tab = document.getElementById('zotero-editpane-pubpeer-tab')
    // tab.hidden = !doi
    // if (!doi) return

    const container = document.getElementById('zotero-editpane-pubpeer-summary')

    let summary = PubPeer.getString('itemPane.noComment')
    const feedback = doi && (await PubPeer.get([doi]))[0]
    if (feedback) {
      summary = PubPeer.getString('itemPane.summary', {...feedback, last_commented_at: feedback.last_commented_at.toLocaleString() }, true)
      summary = `<div xmlns:html="http://www.w3.org/1999/xhtml">${summary}</div>`
      summary = summary.replace(/(<\/?)/g, '$1html:')

      const html = this.dom.parser.parseFromString(summary, 'text/xml')
      for (const a of html.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'a')) {
        if (!a.getAttribute('href')) continue

        a.setAttribute('onclick', 'Zotero.launchURL(this.getAttribute("href")); return false;')
        a.setAttribute('style', 'color: blue')
      }
      summary = this.dom.serializer.serializeToString(html)

      Zotero.debug(`PubPeer.ZoteroItemPane.refresh: ${JSON.stringify(feedback)}: ${summary}`)
    }

    container.innerHTML = summary
  }
}

$patch$(ZoteroItemPane, 'viewItem', original => async function(item, mode, index) {
  let pubPeerIndex = -1

  try {
    PPItemPane.item = item

    const tabPanels = document.getElementById('zotero-editpane-tabs')
    pubPeerIndex = Array.from(tabPanels.children).findIndex(child => child.id === 'zotero-editpane-pubpeer-tab')

    PPItemPane.refresh()
  } catch (err) {
    Zotero.logError(`PubPeer.ZoteroItemPane.viewItem: ${err}`)
    pubPeerIndex = -1
  }

  if (index !== pubPeerIndex) return await original.apply(this, arguments)
})

window.addEventListener('load', event => {
  PPItemPane.load().catch(err => Zotero.logError(err))
}, false)
window.addEventListener('unload', event => {
  PPItemPane.unload().catch(err => Zotero.logError(err))
}, false)

delete require.cache[module.id]
