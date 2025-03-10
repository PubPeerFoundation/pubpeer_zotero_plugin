Components.utils.import('resource://gre/modules/AddonManager.jsm')

import * as $patch$ from './monkey-patch'
import { log } from './debug'
import { DebugLog as DebugLogSender } from 'zotero-plugin/debug-log'
import { flash } from './flash'
import { localize } from './l10n'


/*
function alert({ title, text }: { title?: string; text: string }): void {
  Services.prompt.alert(null, title || 'Alert', text)
}
*/

export function prompt({ title, text, value }: { title?: string; text: string; value?: string }): string {
  const wrap = { value: value || '' }
  if (Services.prompt.prompt(null, title || 'Enter text', text, wrap, null, {})) {
    return wrap.value
  }
  else {
    return ''
  }
}

interface Feedback {
  id: string // DOI
  title: string
  url: string
  total_comments: number
  users: string[]
  last_commented_at?: string
  shown: Record<string, boolean>
}
const empty: Feedback = {
  id: '',
  title: '',
  url: '',
  total_comments: 0,
  users: [],
  shown: {}
}

const NS = {
  XUL: 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul',
  XHTML: 'http://www.w3.org/1999/xhtml',
}

/*
function htmlencode(text) {
  return `${text}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function plaintext(text) {
  return `${text}`
}
*/

function getDOI(item): string {
  let doi: string = item.getField('DOI')
  if (!doi) doi = (item.getField('extra') || '').match(/^DOI:\s*(.+)/im)?.[1]
  log.debug('getDOI(', item.id, ') =', doi || '')
  return (doi || '').toLowerCase()
}

function copyNode(sourceNode: Node, targetDocument) {
  if (sourceNode.nodeType === 3 /*Node.TEXT_NODE */) return targetDocument.createTextNode(sourceNode.textContent)

  const sourceElement: Element = sourceNode as Element

  const targetNode = targetDocument.createElementNS(NS.XHTML, sourceElement.localName)
  for (const attr of Array.from(sourceElement.attributes)) {
    targetNode.setAttribute(attr.name, attr.value)
  }

  for (const child of Array.from(sourceElement.childNodes)) {
    targetNode.appendChild(copyNode(child, targetDocument))
  }

  return targetNode
}

/*
function copyTree(sourceNode, targetNode) {
  while (targetNode.firstChild) {
    targetNode.removeChild(targetNode.firstChild)
  }

  sourceNode.childNodes.forEach(child => {
    targetNode.appendChild(copyNode(child))
  })
}
*/

$patch$.schedule(Zotero.Item.prototype, 'getField', original => function Zotero_Item_prototype_getField(field, _unformatted, _includeBaseMapped): string {
  try {
    if (field === 'pubpeer') {
      if (Zotero.PubPeer.ready.isPending()) return ''
      return `${Zotero.PubPeer.feedback(this).total_comments || ''}`
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
          if ((feedback = Zotero.PubPeer.feedback(item)).last_commented_at && !feedback.shown[this.sessionID]) {
            const text = Zotero.Cite.makeFormattedBibliographyOrCitationList(cslEngine, [item], 'text')
            flash('ALERT: PubPeer feedback', `This article "${item.getField('title')}" has comments on PubPeer: ${feedback.url}\n\n${text}`)
            feedback.shown[this.sessionID] = true
          }
        }
      })
    }
  }
  catch (err) {
    log.error('Zotero.Integration.Session.prototype.addCitation:', err.message)
  }
})

const states = {
  name: [ 'neutral', 'priority', 'muted' ],
  label: { muted: '\u2612', neutral: '\u2610', priority: '\u2611' },
  icon: { neutral: 'pubpeer.png', muted: 'pubpeer-muted.png', loading: 'loading.png', 'highlighted': 'pubpeer-highlighted.png' },
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
    log.info('toggleUser but no item set?')
  }
}

const ready = Zotero.Promise.defer()
export class $PubPeer {
  public item: any

  public ready: Promise<boolean> & { isPending: () => boolean } = ready.promise
  public users: Record<string, 'neutral' | 'priority' | 'muted'> = this.load()
  private dom = new DOMParser
  private serializer = new XMLSerializer

  #feedback: Record<string, Feedback> = {}
  public feedback(item) {
    if (typeof item.id !== 'number') {
      log.error('item is not a Zotero item')
      return empty
    }

    const doi = getDOI(item)
    if (!doi) return empty

    if (doi in this.#feedback) return this.#feedback[doi]

    log.debug('no cached feedback for', item.id, doi, 'among', Object.keys(this.#feedback))
    return empty
  }

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

  public launch(node) {
    const urls = [ node.getAttribute('url'), node.getAttribute('href') ].filter(url => url && url !== '#')
    if (!urls.length) log.debug('launch: no url')
    for (const url of urls) {
      log.debug('launch:', url)
      Zotero.launchURL(url)
    }
    return false
  }

  public save() {
    Zotero.Prefs.set('pubpeer.users', JSON.stringify(this.users))
  }

  public async startup() {
    await Zotero.initializationPromise
    $patch$.execute()
    ready.resolve(true)
    await this.refresh()

    this.itemObserver = Zotero.Notifier.registerObserver(this, ['item'], 'PubPeer', 1)

    DebugLogSender.register('PubPeer', [])

    Zotero.ItemPaneManager.registerSection({
      paneID: 'pubpeer-section-peer-comments',
      pluginID: 'pubpeer@pubpeer.com',
      header: {
        l10nID: 'pubpeer-itempane-header',
        icon: `${ rootURI }content/skin/item-section/header.png`,
      },
      sidenav: {
        l10nID: 'pubpeer-itempane-sidenav',
        icon: `${ rootURI }content/skin/item-section/sidenav.png`,
      },
      bodyXHTML: '<html:div id="zotero-itempane-pubpeer-summary" xmlns:html="http://www.w3.org/1999/xhtml" type="content"/>',
      onItemChange: ({ item }) => {
        this.item = item
      },
      onRender: ({ body, setSectionSummary }) => {
        log.debug('clearing section')
        while (body.firstChild) {
          body.removeChild(body.lastChild)
        }
        setSectionSummary(localize('pubpeer_itemPane_noComment'))
      },
      onAsyncRender: async ({ body, item, setSectionSummary }) => {
        this.item = item
        const feedback = this.feedback(item)
        log.debug('rendering section for', item.id, 'feedback:', feedback)

        const doc = body.ownerDocument

        if (feedback.last_commented_at) {
          let summary = localize('pubpeer_itemPane_summary', {
            ...feedback,
            users: feedback.users.join(', '),
            last_commented_at: feedback.last_commented_at,
          })
          summary = `<div>${summary}</div>`

          const html = this.dom.parseFromString(summary, 'text/xml').documentElement as Element
          for (const a of Array.from(html.querySelectorAll('a'))) {
            if (a.getAttribute('url') || a.getAttribute('href')) {
              a.setAttribute('onclick', 'return Zotero.PubPeer.launch(this)')
              a.setAttribute('style', 'color: blue')
            }
          }
          body.appendChild(copyNode(html, doc))

          for (const user of feedback.users) {
            Zotero.PubPeer.users[user] = Zotero.PubPeer.users[user] || 'neutral'

            const hbox: any = body.appendChild(doc.createElementNS(NS.XUL, 'hbox'))
            hbox.setAttribute('align', 'center')
            hbox.setAttribute('class', `pubpeer-user pubpeer-user-${Zotero.PubPeer.users[user]}`)

            const cb: any = hbox.appendChild(doc.createElementNS(NS.XUL, 'label'))
            const state = Zotero.PubPeer.users[user]
            cb.setAttribute('class', 'pubpeer-checkbox')
            cb.value = states.label[state]
            cb.setAttribute('data-user', user)
            cb.setAttribute('data-state', state)
            cb.onclick = toggleUser

            const label: any = hbox.appendChild(doc.createElementNS(NS.XUL, 'label'))
            label.setAttribute('class', 'pubpeer-username')
            label.setAttribute('value', user)
            label.setAttribute('flex', '8')

            summary = localize('pubpeer_itemPane_section', {
              ...feedback,
              users: feedback.users.join(', '),
              last_commented_at: feedback.last_commented_at,
            })
            setSectionSummary(summary)
          }
        }
      },
    })

    await Zotero.ItemTreeManager.registerColumn?.({
      dataKey: 'pubpeer',
      label: 'PubPeer',
      pluginID: 'pubpeer@pubpeer.com',
      dataProvider: (item, _dataKey) => {
        const feedback = this.feedback(item)
        log.debug('dataProvider:', { feedback })
        // https://groups.google.com/g/zotero-dev/c/4jqa8QIk6DM/m/s86FPjYzAgAJ
        return `${feedback.total_comments || ''}\t${item.id}`
      },
      renderCell: (_index, data, column, isFirstColumn, document) => {
        const cell = document.createElementNS(NS.XHTML, 'span')
        log.debug('renderCell', { data })
        cell.className = `pubpeer cell ${column.className}`
        let icon
        if (data) {
          if (PubPeer.ready.isPending()) {
            icon = states.icon.loading
          }
          else {
            const [ total, itemID ] = data.split('\t')
            cell.textContent = total

            const item = Zotero.Items.get(parseInt(itemID))
            const feedback = this.feedback(item)
            const state = feedback.users.map(user => Zotero.PubPeer.users[user])
            if (state.includes('priority')) {
              icon = states.icon.highlighted
            }
            else if (state.includes('neutral')) {
              icon = states.icon.neutral
            }
            else {
              icon = states.icon.muted
            }
          }
        }
        if (icon) {
          cell.style.paddingLeft = '20px'
          cell.style.backgroundImage = `url(${rootURI}content/skin/${icon})`
          cell.style.backgroundSize = '10px 10px'
          cell.style.backgroundRepeat = 'no-repeat'
          cell.style.backgroundPosition = 'left center'
        }
        return cell
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
    const doc: Document & { createXULElement: any } = win.document as any

    if (doc.querySelector('menuitem.pubpeer')) return

    doc.getElementById('zotero-itemmenu').addEventListener('popupshowing', this, false)
    win.MozXULElement.insertFTLIfNeeded('zotero-pubpeer.ftl')

    const menuitem = doc.createXULElement('menuitem')
    menuitem.className = 'pubpeer'
    // menuitem.setAttribute('data-l10n-id', 'pubpeer_fetchComments')
    menuitem.setAttribute('label', localize('pubpeer_fetchComments'))
    menuitem.addEventListener('command', async () => {
      try {
        await this.fetch()
      }
      catch (err) {
        log.error('fetch failed:', err)
      }
    })
    doc.getElementById('zotero-itemmenu').appendChild(menuitem)
  }

  public async fetch(): Promise<void> {
    const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems() || []
    const dois = selectedItems.map(item => getDOI(item)).filter(_ => _)
    if (!dois.length) return

    for (const feedback of await this.get(dois)) {
      if (feedback) {
        let output = `The selected item has ${feedback.total_comments} ${feedback.total_comments === 1 ? 'comment' : 'comments'} on PubPeer`
        if (feedback.total_comments) output += ` ${feedback.url}`
        flash('PubPeer', output)
      }
    }

    Zotero.ItemTreeManager.refreshColumns()
  }

  public onMainWindowUnload(win: Window) {
    const doc = win.document
    doc.getElementById('zotero-itemmenu').removeEventListener('popupshowing', this, false)

    for (const elt of Array.from(doc.getElementsByClassName('pubpeer'))) {
      elt.remove()
    }
    doc.querySelector('[href="pubpeer.ftl"]').remove()
  }

  public handleEvent(_event: any) {
    // const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems()
    // TODO: hide menu element when appropriate
  }

  public async get(dois, options: { refresh?: boolean } = {}): Promise<Feedback[]> {
    dois = dois.map(doi => doi.toLowerCase())
    const refresh = [...(new Set(options.refresh ? dois : dois.filter(doi => !this.#feedback[doi.toLowerCase()]?.last_commented_at)))]
    log.debug('refresh: retrieving', refresh)

    if (refresh.length) {
      const chunkSize = 40
      const chunks = Array.from({ length: Math.ceil(refresh.length / chunkSize) }, (v, i) => refresh.slice(i * chunkSize, i * chunkSize + chunkSize))
      await Promise.allSettled(chunks.map(chunk => this.request(chunk)))
    }

    log.debug('refresh: feedback cached for', Object.keys(this.#feedback))
    return dois.map((doi: string) => this.#feedback[doi]) as Feedback[]
  }

  private async request(dois): Promise<void> {
    try {
      const pubpeer = (await Zotero.HTTP.request('POST', 'https://pubpeer.com/v3/publications?devkey=PubPeerZotero', {
        body: JSON.stringify({ dois }),
        responseType: 'json',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      })).response

      log.debug('refresh: received', pubpeer)

      for (const feedback of (pubpeer.feedbacks || [])) {
        if (!feedback.last_commented_at.timezone) {
          log.debug(`PubPeer.get: ${feedback.id} has no timezone`)
        }
        else if (feedback.last_commented_at.timezone !== 'UTC') {
          log.debug(`PubPeer.get: ${feedback.id} has timezone ${feedback.last_commented_at.timezone}`)
        }

        const last_commented_at = Date.parse(`${feedback.last_commented_at.date}${(feedback.last_commented_at.timezone || 'UTC').replace(/^UTC$/, 'Z')}`)
        feedback.id = feedback.id.toLowerCase()
        this.#feedback[feedback.id] = {
          ...feedback,
          last_commented_at: isNaN(last_commented_at) ? `${feedback.last_commented_at.date}${feedback.last_commented_at.timezone || ''}` : (new Date(last_commented_at)).toLocaleString(),
          users: feedback.users.split(/\s*,\s*/).filter((u: string) => u),
          shown: {},
        }
        for (const user of this.#feedback[feedback.id].users) {
          this.users[user] = this.users[user] || 'neutral'
        }
      }
    }
    catch (err) {
      log.error(`PubPeer.get(${dois}): ${err}`)
    }
  }

  private async refresh() {
    const query = `
      SELECT DISTINCT fields.fieldName, itemDataValues.value
      FROM fields
      JOIN itemData on fields.fieldID = itemData.fieldID
      JOIN itemDataValues on itemData.valueID = itemDataValues.valueID
      WHERE fieldname IN ('extra', 'DOI')
    `.replace(/[\s\n]+/g, ' ').trim()

    const dois: string[] = []
    for (const doi of (await Zotero.DB.queryAsync(query) as { fieldName: string, value: string }[])) {
      switch (doi.fieldName) {
        case 'extra':
          dois.push(doi.value.match(/^DOI:\s*(.+)/im)?.[1])
          break
        case 'DOI':
          dois.push(doi.value)
          break
      }
    }

    await this.get(dois.filter(_ => _), { refresh: true })

    setTimeout(this.refresh.bind(this), 24 * 60 * 60 * 1000)
  }

  protected async notify(action: string, type: string, ids: number[], _extraData: any) {
    if (type !== 'item' || (action !== 'modify' && action !== 'add')) return

    const dois = (await Zotero.Items.getAsync(ids)).map(item => getDOI(item)).filter(_ => _)
    if (dois.length) await this.get(dois)
  }
}

export var PubPeer = Zotero.PubPeer = new $PubPeer // eslint-disable-line no-var
