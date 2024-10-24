Components.utils.import('resource://gre/modules/AddonManager.jsm')

import * as $patch$ from './monkey-patch'
import { debug } from './debug'
import { DebugLog as DebugLogSender } from 'zotero-plugin/debug-log'
import { flash } from './flash'
import { localize } from './l10n'

interface Feedback {
  id: string // DOI
  title: string
  url: string
  total_comments: number
  users: string[]
  last_commented_at: Date
  shown: Record<string, boolean>
}

const xul = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul'

/*
function htmlencode(text) {
  return `${text}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function plaintext(text) {
  return `${text}`
}
*/

function getDOI(item): string {
  const doi: string = item.getField('DOI')
  if (doi) return doi

  const extra = item.getField('extra')
  if (!extra) return ''

  const dois: string[] = extra.split('\n')
    .map((line: string) => line.match(/^DOI:\s*(.+)/i))
    .filter((line: string) => line)
    .map((line: string) => line[1].trim())
  return dois[0] || ''
}

const itemTree = require('zotero/itemTree')
$patch$.schedule(itemTree.prototype, 'getColumns', original => function Zotero_ItemTree_prototype_getColumns() {
  const columns = original.apply(this, arguments)
  columns.push(/* splice(insertAfter + 1, 0, */{
    dataKey: 'pubpeer',
    label: 'PubPeer',
    flex: '1',
    zoteroPersist: new Set(['width', 'ordinal', 'hidden', 'sortActive', 'sortDirection']),
  })

  return columns
})

$patch$.schedule(itemTree.prototype, '_renderCell', original => function Zotero_ItemTree_prototype_renderCell(index, data, col) {
  if (col.dataKey !== 'pubpeer') return original.apply(this, arguments)

  const content = document.createElementNS('http://www.w3.org/1999/xhtml', 'span')
  content.className = 'cell-text'

  const cell = document.createElementNS('http://www.w3.org/1999/xhtml', 'span')
  cell.className = `cell ${col.className}`
  cell.append(content)

  let feedback

  const item = this.getRow(index).ref
  if (item.isRegularItem()) {
    if (PubPeer.ready.isPending()) {
      content.className = 'pubpeer-state-loading'
    }
    else if (feedback = Zotero.PubPeer.feedback[getDOI(item)]) {
      content.innerText = `${feedback.total_comments}`

      const state = feedback.users.map(user => Zotero.PubPeer.users[user])
      if (state.includes('priority')) {
        content.className = 'pubpeer-state-highlighted'
      }
      else if (state.includes('neutral')) {
        content.className = 'pubpeer-state-neutral'
      }
      else {
        content.className = 'pubpeer-state-muted'
      }
    }
  }

  return cell
})

$patch$.schedule(Zotero.Item.prototype, 'getField', original => function Zotero_Item_prototype_getField(field, _unformatted, _includeBaseMapped): string {
  try {
    if (field === 'pubpeer') {
      if (Zotero.PubPeer.ready.isPending()) return ''
      const doi = getDOI(this)
      if (!doi || !Zotero.PubPeer.feedback[doi]) return ''
      return ' '
    }
  }
  catch (err) {
    Zotero.logError(`pubpeer patched getField: ${err}`)
    return ''
  }

  return original.apply(this, arguments) as string
})

$patch$.schedule(Zotero.Integration.Session.prototype, 'addCitation', original => async function(index, noteIndex, citation) {
  await original.apply(this, arguments)
  try {
    const ids = citation.citationItems.map((item: { id: number }) => item.id)

    const style = Zotero.Styles.get('http://www.zotero.org/styles/apa')
    const cslEngine = style.getCiteProc('en-US')

    if (ids.length) {
      Zotero.Items.getAsync(ids).then(items => {
        let feedback: Feedback
        for (const item of items) {
          if (feedback = Zotero.PubPeer.feedback[getDOI(item)]) {
            if (!feedback.shown[this.sessionID]) {
              const text = Zotero.Cite.makeFormattedBibliographyOrCitationList(cslEngine, [item], 'text')
              flash('ALERT: PubPeer feedback', `This article "${item.getField('title')}" has comments on PubPeer: ${feedback.url}\n\n${text}`)
              feedback.shown[this.sessionID] = true
            }
          }
        }
      })
    }
  }
  catch (err) {
    debug('Zotero.Integration.Session.prototype.addCitation:', err.message)
  }
})

const states = {
  name: [ 'neutral', 'priority', 'muted' ],
  label: { muted: '\u2612', neutral: '\u2610', priority: '\u2611' },
}
function toggleUser() {
  const user = this.getAttribute('data-user')
  const state = states.name[(states.name.indexOf(this.getAttribute('data-state')) + 1) % states.name.length]

  Zotero.PubPeer.users[user] = (state as 'neutral') // bypass TS2322
  this.parentElement.setAttribute('class', `pupbeer pubpeer-user pubpeer-user-${state}`)
  this.value = states.label[state]
  this.setAttribute('data-state', state)
  Zotero.PubPeer.save()

  // update display panes by issuing a fake item-update notification
  if (Zotero.PubPeer.item) {
    Zotero.Notifier.trigger('modify', 'item', [Zotero.PubPeer.item.id])
  }
  else {
    debug('toggleUser but no item set?')
  }
}

const ready = Zotero.Promise.defer()
export class $PubPeer {
  public ready: Promise<boolean> & { isPending: () => boolean } = ready.promise
  public feedback: { [DOI: string]: Feedback } = {}
  public users: Record<string, 'neutral' | 'priority' | 'muted'> = this.load()
  private dom = new DOMParser
  private serializer = new XMLSerializer
  public item: any
  
  private itemObserver: number

  public load(): Record<string, 'neutral' | 'priority' | 'muted'> {
    try {
      return JSON.parse(Zotero.Prefs.get('pubpeer.users') || '{}') as Record<string, 'neutral' | 'priority' | 'muted'>
    }
    catch (err) {
      Zotero.logError(err)
      return {}
    }
  }

  public save() {
    Zotero.Prefs.set('pubpeer.users', JSON.stringify(this.users))
  }

  public async startup() {
    await Zotero.initializationPromise
    $patch$.execute()
    ready.resolve(true)
    await this.refresh()

    Zotero.getActiveZoteroPane().itemsView.refreshAndMaintainSelection()

    this.itemObserver = Zotero.Notifier.registerObserver(this, ['item'], 'PubPeer', 1)

    DebugLogSender.register('PubPeer', [])

    Zotero.ItemPaneManager.registerSection({
      paneID: 'pubpeer-section-peer-comments',
      pluginID: 'pubpeer@pubpeer.com',
      header: {
        l10nID: 'pubpeer-itempane-header',
        icon: `${ rootURI }content/skin/item-section/header.svg`,
      },
      sidenav: {
        l10nID: 'pubpeer-itempane-sidenav',
        icon: `${ rootURI }content/skin/item-section/sidenav.svg`,
      },
      bodyXHTML: '<html:div id="zotero-itempane-pubpeer-summary" xmlns:html="http://www.w3.org/1999/xhtml" type="content"/>',
      onItemChange: ({ item }) => {
        this.item = item
      },
      onRender: ({ body, setSectionSummary }) => {
        while (body.firstChild) {
          body.removeChild(body.lastChild);
        }
        setSectionSummary(localize('pubpeer_itemPane_noComment'))
      },
      onAsyncRender: async ({ body, item }) => {
        this.item = item
        const doi = item.getField('DOI')
        const feedback = doi && (await PubPeer.get([doi]))[0]
        if (feedback) {
          let summary = localize('pubpeer_itemPane_summary', {
            ...feedback,
            users: feedback.users.join(', '),
            last_commented_at: feedback.last_commented_at.toLocaleString()
          })
          summary = `<div xmlns:html="http://www.w3.org/1999/xhtml">${summary}</div>`
          summary = summary.replace(/(<\/?)/g, '$1html:')

          const html = this.dom.parseFromString(summary, 'text/xml').documentElement as Element
          for (const a of Array.from(html.querySelectorAll('a'))) {
            if (a.getAttribute('url')) {
              a.setAttribute('onclick', 'Zotero.launchURL(this.getAttribute("url")); return false;')
              a.setAttribute('style', 'color: blue')
            }
          }
          body.appendChild(html)

          for (const user of feedback.users) {
            Zotero.PubPeer.users[user] = Zotero.PubPeer.users[user] || 'neutral'

            const hbox: any = body.appendChild(body.ownerDocument.createElementNS(xul, 'hbox'))
            hbox.setAttribute('align', 'center')
            hbox.setAttribute('class', `pubpeer-user pubpeer-user-${Zotero.PubPeer.users[user]}`)

            const cb: any = hbox.appendChild(body.ownerDocument.createElementNS(xul, 'label'))
            const state = Zotero.PubPeer.users[user]
            cb.setAttribute('class', 'pubpeer-checkbox')
            cb.value = states.label[state]
            cb.setAttribute('data-user', user)
            cb.setAttribute('data-state', state)
            cb.onclick = toggleUser

            const label: any = hbox.appendChild(body.ownerDocument.createElementNS(xul, 'label'))
            label.setAttribute('class', 'pubpeer-username')
            label.setAttribute('value', user)
            label.setAttribute('flex', '8')
          }

          // setSectionSummary(localize('pubpeer_itemPane_summary', { total_comments: feedback.total_comments, url, last_commented_at, }))
        }
      },
    })

		for (const win of Zotero.getMainWindows()) {
			if (win.ZoteroPane) this.onMainWindowLoad(win)
		}
  }
  public async shutdown() {
		for (const win of Zotero.getMainWindows()) {
			if (win.ZoteroPane) this.onMainWindowUnload(win)
		}
    Zotero.Notifier.unregisterObserver(this.itemObserver)
    $patch$.unpatch()
  }

  public onMainWindowLoad(win: Window & { MozXULElement: any }) {
    debug('onMainWindowLoad:', win.location.href)
    const doc: Document & { createXULElement: any } = win.document as any

    doc.getElementById('zotero-itemmenu').addEventListener('popupshowing', this, false)
    win.MozXULElement.insertFTLIfNeeded('pubpeer.ftl')

    const menuitem = doc.createXULElement('menuitem')
    menuitem.className = 'pubpeer'
    menuitem.setAttribute('data-l10n-id', 'pubpeer_fetchComments')
    menuitem.addEventListener('command', () => { Zotero.PubPeer.run('getPubPeerLink') })
    doc.getElementById('menu_viewPopup').appendChild(menuitem)
  }

  public run(method: string, ...args): void {
    this[method](...args).catch(err => Zotero.logError(`${method}: ${err}`))
  }

  public async getPubPeerLink(): Promise<void> {
    const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems()
    if (selectedItems.length !== 1) return
    const doi = selectedItems[0].getField('DOI')
    if (!doi) return

    const feedback = (await Zotero.PubPeer.get([ doi ]))[0]
    if (feedback) {
      let output = `The selected item has ${feedback.total_comments} ${feedback.total_comments === 1 ? 'comment' : 'comments'} on PubPeer`
      if (feedback.total_comments) output += ` ${feedback.url}`
      alert(output)
    }
  }

  public onMainWindowUnload(win: Window) {
    debug('onMainWindowUnload:', win.location.href)
    const doc = win.document
    doc.getElementById('zotero-itemmenu').removeEventListener('popupshowing', this, false)

    Array.from(doc.getElementsByClassName('pubpeer')).forEach(elt => {
      elt.remove()
    })
    doc.querySelector('[href="pubpeer.ftl"]').remove()
  }

  public handleEvent(_event: any) {
    // const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems()
    // TODO: hide menu element when appropriate
  }

  public async get(dois, options: { refresh?: boolean } = {}): Promise<Feedback[]> {
    const fetch = options.refresh ? dois : dois.filter(doi => !this.feedback[doi])

    if (fetch.length) {
      try {
        const pubpeer = await Zotero.HTTP.request('POST', 'https://pubpeer.com/v3/publications?devkey=PubPeerZotero', {
          body: JSON.stringify({ dois: fetch }),
          responseType: 'json',
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        })

        for (const feedback of (pubpeer?.response?.feedbacks || [])) {
          if (feedback.last_commented_at.timezone !== 'UTC') debug(`PubPeer.get: ${feedback.id} has timezone ${feedback.last_commented_at.timezone}`)
          this.feedback[feedback.id] = {
            ...feedback,
            last_commented_at: new Date(feedback.last_commented_at.date as string + 'Z'),
            users: feedback.users.split(/\s*,\s*/).filter((u: string) => u),
            shown: {},
          }
          for (const user of this.feedback[feedback.id].users) {
            this.users[user] = this.users[user] || 'neutral'
          }
        }
      }
      catch (err) {
        debug(`PubPeer.get(${fetch}): ${err}`)
      }
    }

    return dois.map((doi: string) => this.feedback[doi]) as Feedback[]
  }

  private async refresh() {
    const query = `
      SELECT DISTINCT fields.fieldName, itemDataValues.value
      FROM fields
      JOIN itemData on fields.fieldID = itemData.fieldID
      JOIN itemDataValues on itemData.valueID = itemDataValues.valueID
      WHERE fieldname IN ('extra', 'DOI')
    `.replace(/[\s\n]+/g, ' ').trim()

    let dois: string[] = []
    for (const doi of (await Zotero.DB.queryAsync(query) as { fieldName: string, value: string }[])) {
      switch (doi.fieldName) {
        case 'extra':
          dois = dois.concat(doi.value.split('\n').map((line: string) => line.match(/^DOI:\s*(.+)/i)).filter(line => line).map(line => line[1].trim()))
          break
        case 'DOI':
          dois.push(doi.value)
          break
      }
    }

    await this.get(dois, { refresh: true })

    setTimeout(this.refresh.bind(this), 24 * 60 * 60 * 1000)
  }

  protected async notify(action: string, type: string, ids: number[], _extraData: any) {
    if (type !== 'item' || (action !== 'modify' && action !== 'add')) return

    const dois = []
    for (const item of (await Zotero.Items.getAsync(ids))) {
      const doi = getDOI(item)
      if (doi && !dois.includes(doi)) dois.push(doi)
    }
    if (dois.length) await this.get(dois)
  }
}

export var PubPeer = Zotero.PubPeer = new $PubPeer // eslint-disable-line no-var
