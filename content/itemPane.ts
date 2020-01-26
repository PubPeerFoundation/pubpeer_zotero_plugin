declare const Zotero: IZotero
declare const Components: any
declare const ZoteroItemPane: any

import { patch as $patch$ } from './monkey-patch'
import { debug } from './debug'

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
  if (PPItemPane.item) {
    Zotero.Notifier.trigger('modify', 'item', [PPItemPane.item.id])
  } else {
    debug('toggleUser but no item set?')
  }
}

const xul = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul'

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
    const container = document.getElementById('zotero-editpane-pubpeer')
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
      for (const a of html.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'a')) {
        if (!a.getAttribute('href')) continue

        a.setAttribute('onclick', 'Zotero.launchURL(this.getAttribute("href")); return false;')
        a.setAttribute('style', 'color: blue')
      }
      summary = this.dom.serializer.serializeToString(html)

      debug(`PubPeer.ZoteroItemPane.refresh: ${JSON.stringify(feedback)}: ${summary}`)

      for (const user of feedback.users) {
        Zotero.PubPeer.users[user] = Zotero.PubPeer.users[user] || 'neutral'

        const hbox: any = container.appendChild(document.createElementNS(xul, 'hbox'))
        hbox.setAttribute('align', 'center')
        hbox.setAttribute('class', `pubpeer-user pubpeer-user-${Zotero.PubPeer.users[user]}`)

        const cb: any = hbox.appendChild(document.createElementNS(xul, 'label'))
        const state = Zotero.PubPeer.users[user]
        cb.setAttribute('class', 'pubpeer-checkbox')
        cb.value = states.label[state]
        cb.setAttribute('data-user', user)
        cb.setAttribute('data-state', state)
        cb.onclick = toggleUser

        const label: any = hbox.appendChild(document.createElementNS(xul, 'label'))
        label.setAttribute('class', 'pubpeer-username')
        label.setAttribute('value', user)
        label.setAttribute('flex', '8')
      }
    }

    document.getElementById('zotero-editpane-pubpeer-summary').innerHTML = summary
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
