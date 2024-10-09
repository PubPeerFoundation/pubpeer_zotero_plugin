declare const ZoteroItemPane: any

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

import { patch as $patch$ } from './monkey-patch'
import { debug } from './debug'

const loaded: { document: HTMLDocument } = { document: null }

const states = {
  name: [ 'neutral', 'priority', 'muted' ],
  label: { muted: '\u2612', neutral: '\u2610', priority: '\u2611' },
}

function toggleUser() {
  const user = this.getAttribute('data-user')
  const state = states.name[(states.name.indexOf(this.getAttribute('data-state')) + 1) % states.name.length]

  Zotero.PubPeer.users[user] = (state as 'neutral') // bypass TS2322
  this.parentElement.setAttribute('class', `pubpeer-user pubpeer-user-${state}`)
  this.value = states.label[state]
  this.setAttribute('data-state', state)
  Zotero.PubPeer.save()

  // update display panes by issuing a fake item-update notification
  if (Zotero.PubPeer.ItemPane.item) {
    Zotero.Notifier.trigger('modify', 'item', [Zotero.PubPeer.ItemPane.item.id])
  }
  else {
    debug('toggleUser but no item set?')
  }
}

const xul = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul'

export class ItemPane {
  public item: any = null

  private observer: number = null

  private dom = {
    parser: new DOMParser,
    serializer: new XMLSerializer,
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

  // eslint-disable-next-line @typescript-eslint/require-await
  public async load(globals: Record<string, any>) { // async because of call in itemPane.xul
    loaded.document = globals.document
    this.observer = Zotero.Notifier.registerObserver(this, ['item'], 'PubPeer')
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async unload() { // async because of call in itemPane.xul
    Zotero.Notifier.unregisterObserver(this.observer)
  }

  public async refresh() {
    const container = loaded.document.getElementById('zotero-editpane-pubpeer')
    for (const hbox of Array.from(container.getElementsByTagNameNS(xul, 'hbox'))) {
      hbox.remove()
    }

    const doi = this.item?.getField('DOI')
    let summary = Zotero.PubPeer.getString('itemPane.noComment')
    const feedback = doi && (await Zotero.PubPeer.get([doi]))[0]
    if (feedback) {
      summary = Zotero.PubPeer.getString('itemPane.summary', {...feedback, users: feedback.users.join(', '), last_commented_at: feedback.last_commented_at.toLocaleString() }, true)
      summary = `<div xmlns:html="http://www.w3.org/1999/xhtml">${summary}</div>`
      summary = summary.replace(/(<\/?)/g, '$1html:')

      const html = this.dom.parser.parseFromString(summary, 'text/xml')
      for (const a of Array.from(html.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'a'))) {
        if (!a.getAttribute('url')) continue

        a.setAttribute('onclick', 'Zotero.launchURL(this.getAttribute("url")); return false;')
        a.setAttribute('style', 'color: blue')
      }
      summary = this.dom.serializer.serializeToString(html)

      debug(`PubPeer.ZoteroItemPane.refresh: ${JSON.stringify(feedback)}: ${summary}`)

      for (const user of feedback.users) {
        Zotero.PubPeer.users[user] = Zotero.PubPeer.users[user] || 'neutral'

        const hbox: any = container.appendChild(loaded.document.createElementNS(xul, 'hbox'))
        hbox.setAttribute('align', 'center')
        hbox.setAttribute('class', `pubpeer-user pubpeer-user-${Zotero.PubPeer.users[user]}`)

        const cb: any = hbox.appendChild(loaded.document.createElementNS(xul, 'label'))
        const state = Zotero.PubPeer.users[user]
        cb.setAttribute('class', 'pubpeer-checkbox')
        cb.value = states.label[state]
        cb.setAttribute('data-user', user)
        cb.setAttribute('data-state', state)
        cb.onclick = toggleUser

        const label: any = hbox.appendChild(loaded.document.createElementNS(xul, 'label'))
        label.setAttribute('class', 'pubpeer-username')
        label.setAttribute('value', user)
        label.setAttribute('flex', '8')
      }
    }

    loaded.document.getElementById('zotero-editpane-pubpeer-summary').innerHTML = summary
  }
}

$patch$(ZoteroItemPane, 'viewItem', original => async function(item, mode, index) {
  let pubPeerIndex = -1

  try {
    Zotero.PubPeer.ItemPane.item = item

    const tabPanels = loaded.document.getElementById('zotero-editpane-tabs')
    pubPeerIndex = Array.from(tabPanels.children).findIndex(child => child.id === 'zotero-editpane-pubpeer-tab')

    Zotero.PubPeer.ItemPane.refresh().catch(err => {
      Zotero.logError(err)
    })
  }
  catch (err) {
    Zotero.logError(`PubPeer.ZoteroItemPane.viewItem: ${err}`)
    pubPeerIndex = -1
  }

  if (index !== pubPeerIndex) return await original.apply(this, arguments)
})
