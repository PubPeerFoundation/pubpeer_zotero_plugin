import { DebugLogSender } from 'zotero-plugin/debug-log'
import { log } from './debug'
import { flash } from './flash'
import { localize } from './l10n'
import * as $patch$ from './monkey-patch'

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
  shown: {},
}

// A lookup result, kept on disk so a restart does not ask PubPeer about the whole library again.
// `feedback` is absent when PubPeer has no comments on the DOI.
interface CacheEntry {
  expires: number
  feedback?: Feedback
}

const DAY = 24 * 60 * 60 * 1000
// Papers with comments are re-checked daily, papers without weekly. Each expiry is jittered so a
// library fetched in one go is re-checked a slice at a time rather than all on the same day.
const TTL = { commented: DAY, uncommented: 7 * DAY }
// PubPeer answers 20 requests a minute per IP, and 200 DOIs a minute. Ten DOIs a request, about
// 17 requests a minute, stays under both with a margin, so a lone Zotero install is not throttled.
const CHUNK_SIZE = 10
const REQUEST_INTERVAL = 3500
const REFRESH_INTERVAL = 6 * 60 * 60 * 1000
const MAX_ATTEMPTS = 3

function expiry(ttl: number): number {
  return Date.now() + Math.round(ttl * (0.5 + Math.random()))
}

// PubPeer sends `Y-m-d H:i:s` in UTC. Comment times are public at day precision, so show the date.
function commentedAt(value: string | { date?: string } | undefined): string {
  const raw = typeof value === 'string' ? value : value?.date
  if (!raw) return '?'
  const parsed = Date.parse(`${raw.trim().replace(' ', 'T').replace(/[.]\d+$/, '')}Z`)
  return isNaN(parsed) ? raw : new Date(parsed).toLocaleDateString()
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
  return (doi || '').trim().toLowerCase()
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

$patch$.schedule(Zotero.Item.prototype, 'getField', original => function Zotero_Item_prototype_getField(this: any, field, _unformatted, _includeBaseMapped): string {
  try {
    if (field === 'pubpeer') {
      return `${Zotero.PubPeer.feedback(this).total_comments || ''}`
    }
  }
  catch (err) {
    Zotero.logError(`pubpeer patched getField: ${err}`)
    return ''
  }

  return original.apply(this, arguments) as string
})

$patch$.schedule(Zotero.Integration.Session.prototype, 'addCitation', original => async function(this: any, index, noteIndex, citation) {
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
    log.error('Zotero.Integration.Session.prototype.addCitation:', err instanceof Error ? err.message : String(err))
  }
})

const states = {
  name: ['neutral', 'priority', 'muted'],
  label: { muted: '\u2612', neutral: '\u2610', priority: '\u2611' },
  icon: { neutral: 'pubpeer.png', muted: 'pubpeer-muted.png', loading: 'loading.png', highlighted: 'pubpeer-highlighted.png' },
}

function toggleUser(this: HTMLElement & { value: string }) {
  const user = this.getAttribute('data-user')
  const parent = this.parentElement
  if (!user || !parent) return
  const currentState = this.getAttribute('data-state') || 'neutral'
  const state = states.name[(states.name.indexOf(currentState) + 1) % states.name.length]

  Zotero.PubPeer.users[user] = state as 'neutral' // bypass TS2322
  parent.setAttribute('class', `pupbeer pubpeer-user pubpeer-user-${state}`)
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

type XULWindow = Window & { MozXULElement: any; ZoteroPane: any }
const ready = Zotero.Promise.defer()
let sender: DebugLogSender | undefined
export class $PubPeer {
  public item: any

  public ready: Promise<boolean> = ready.promise
  public users: Record<string, 'neutral' | 'priority' | 'muted'> = this.load()
  private dom = new DOMParser()
  private serializer = new XMLSerializer()

  #cache: Record<string, CacheEntry> = {}
  #nextSlot = 0
  #stopped = false
  #refreshTimer: ReturnType<typeof setTimeout> | undefined
  #columnsRefreshedAt = 0
  #saving: Promise<void> = Promise.resolve()

  public feedback(item) {
    if (typeof item.id !== 'number') {
      log.error('item is not a Zotero item')
      return empty
    }

    const doi = getDOI(item)
    if (!doi) return empty

    return this.#cache[doi]?.feedback || empty
  }

  private itemObserver!: number

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
    const urls = [node.getAttribute('url'), node.getAttribute('href')].filter(url => url && url !== '#')
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
    ready.resolve(true)
    await this.loadCache()

    $patch$.execute()

    this.itemObserver = Zotero.Notifier.registerObserver(this, ['item'], 'PubPeer', 1)

    sender = new DebugLogSender('zotero-pubpeer@pubpeer.com', 'Send PubPeer debug log', [])
    sender.enabled = true

    Zotero.ItemPaneManager.registerSection({
      paneID: 'pubpeer-section-peer-comments',
      pluginID: 'pubpeer@pubpeer.com',
      header: {
        l10nID: 'pubpeer-itempane-header',
        icon: `${rootURI}content/skin/item-section/header.png`,
      },
      sidenav: {
        l10nID: 'pubpeer-itempane-sidenav',
        icon: `${rootURI}content/skin/item-section/sidenav.png`,
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

    await Zotero.ItemTreeManager.registerColumn({
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
          const [total, itemID] = data.split('\t')
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
      if (win.ZoteroPane) this.onMainWindowLoad({ window: win })
    }

    // In the background: with the requests paced, a large library takes a while on the first run
    this.#refreshTimer = setTimeout(() => this.refresh(), 0)
  }
  public async shutdown() {
    this.#stopped = true
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    await this.saveCache()
    if (sender) sender.enabled = false
    for (const win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.onMainWindowUnload({ window: win })
    }
    Zotero.Notifier.unregisterObserver(this.itemObserver)
    $patch$.unpatch()
  }

  public onMainWindowLoad({ window }: { window: XULWindow }) {
    const doc: Document & { createXULElement: any } = window.document as any

    if (doc.querySelector('menuitem.pubpeer')) return

    const itemMenu = doc.getElementById('zotero-itemmenu')
    if (!itemMenu) return
    itemMenu.addEventListener('popupshowing', this, false)
    window.MozXULElement.insertFTLIfNeeded('zotero-pubpeer.ftl')

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
    itemMenu.appendChild(menuitem)
  }

  public async fetch(): Promise<void> {
    const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems() || []
    const dois = selectedItems.map(item => getDOI(item)).filter(_ => _)
    if (!dois.length) return

    for (const feedback of await this.get(dois, { force: true })) {
      if (feedback) {
        let output = `The selected item has ${feedback.total_comments} ${feedback.total_comments === 1 ? 'comment' : 'comments'} on PubPeer`
        if (feedback.total_comments) output += ` ${feedback.url}`
        flash('PubPeer', output)
      }
    }
  }

  public onMainWindowUnload({ window }: { window: XULWindow }) {
    const doc = window.document
    doc.getElementById('zotero-itemmenu')?.removeEventListener('popupshowing', this, false)

    for (const elt of Array.from(doc.getElementsByClassName('pubpeer'))) {
      elt.remove()
    }
    doc.querySelector('[href="pubpeer.ftl"]')?.remove()
  }

  public handleEvent(_event: any) {
    // const selectedItems = Zotero.getActiveZoteroPane().getSelectedItems()
    // TODO: hide menu element when appropriate
  }

  // Looks up the DOIs that are not cached or have expired, or all of them with `force`
  public async get(dois: string[], options: { force?: boolean } = {}): Promise<(Feedback | undefined)[]> {
    dois = [...new Set(dois.map(doi => doi.trim().toLowerCase()))]
    const now = Date.now()
    const lookup = options.force ? dois : dois.filter(doi => !(this.#cache[doi]?.expires > now))
    log.debug('get: looking up', lookup)

    for (let i = 0; i < lookup.length; i += CHUNK_SIZE) {
      if (!await this.request(lookup.slice(i, i + CHUNK_SIZE))) break
    }
    if (lookup.length) {
      this.refreshColumns(true)
      await this.saveCache()
    }

    return dois.map(doi => this.#cache[doi]?.feedback)
  }

  // Waits for this request's turn: one every REQUEST_INTERVAL, later if PubPeer asked us to back off
  private async slot(): Promise<void> {
    const now = Date.now()
    const at = Math.max(now, this.#nextSlot)
    this.#nextSlot = at + REQUEST_INTERVAL
    if (at > now) await Zotero.Promise.delay(at - now)
  }

  private api(): { url: string; headers: Record<string, string> } {
    // `pubpeer.api` and `pubpeer.headers` (JSON) let a tester point the plugin at a staging server
    let headers: Record<string, string> = {}
    try {
      headers = JSON.parse(Zotero.Prefs.get('pubpeer.headers') || '{}')
    }
    catch (err) {
      log.error('pubpeer.headers is not valid JSON:', err)
    }
    const base = (Zotero.Prefs.get('pubpeer.api') || 'https://pubpeer.com').replace(/\/+$/, '')
    return { url: `${base}/v3/publications?devkey=PubPeerZotero`, headers }
  }

  // Returns false when the chunk could not be looked up, so a caller can stop for now
  private async request(dois: string[]): Promise<boolean> {
    const api = this.api()

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.slot()
      if (this.#stopped) return false

      let xhr
      try {
        xhr = await Zotero.HTTP.request('POST', api.url, {
          body: JSON.stringify({ dois }),
          responseType: 'json',
          headers: { ...api.headers, 'Content-Type': 'application/json;charset=UTF-8' },
          successCodes: [200, 429],
        })
      }
      catch (err) {
        log.error(`PubPeer.request(${dois}): ${err}`)
        return false
      }

      if (xhr.status === 429) {
        const retryAfter = parseInt(xhr.getResponseHeader('Retry-After'))
        log.debug(`PubPeer.request: throttled, retry after ${retryAfter}s`)
        this.#nextSlot = Math.max(this.#nextSlot, Date.now() + (isNaN(retryAfter) ? 60 : Math.max(retryAfter, 1)) * 1000)
        continue
      }

      this.store(dois, xhr.response?.feedbacks || [])
      return true
    }

    return false
  }

  private store(dois: string[], feedbacks: any[]) {
    log.debug('store: received', feedbacks)

    const found: Record<string, Feedback> = {}
    for (const feedback of feedbacks) {
      const id = `${feedback.id || ''}`.toLowerCase()
      if (!id) continue

      found[id] = {
        id,
        title: feedback.title || '',
        url: feedback.url || '',
        total_comments: feedback.total_comments || 0,
        users: `${feedback.users || ''}`.split(/\s*,\s*/).filter((u: string) => u),
        last_commented_at: commentedAt(feedback.last_commented_at),
        shown: this.#cache[id]?.feedback?.shown || {},
      }
      for (const user of found[id].users) {
        this.users[user] = this.users[user] || 'neutral'
      }
    }

    for (const doi of new Set([...dois, ...Object.keys(found)])) {
      const feedback = found[doi]
      this.#cache[doi] = { expires: expiry(feedback ? TTL.commented : TTL.uncommented), feedback }
    }

    if (Object.keys(found).length) this.refreshColumns()
  }

  private refreshColumns(force = false) {
    if (!force && Date.now() - this.#columnsRefreshedAt < 15000) return
    this.#columnsRefreshedAt = Date.now()
    Zotero.ItemTreeManager.refreshColumns()
  }

  private cachePath(): string {
    return PathUtils.join(Zotero.DataDirectory.dir, 'pubpeer-cache.json')
  }

  private async loadCache() {
    try {
      const path = this.cachePath()
      if (!await IOUtils.exists(path)) return
      const cache = await IOUtils.readJSON(path)
      if (cache?.version !== 1) return
      for (const [doi, entry] of Object.entries(cache.entries as Record<string, CacheEntry>)) {
        this.#cache[doi] = entry.feedback ? { ...entry, feedback: { ...entry.feedback, shown: {} } } : entry
      }
      log.debug('loadCache:', Object.keys(this.#cache).length, 'DOIs')
    }
    catch (err) {
      log.error('loadCache failed:', err)
    }
  }

  // Writes are chained so a refresh and a lookup finishing together do not write the file at once
  private saveCache(): Promise<void> {
    this.#saving = this.#saving.then(() => this.writeCache())
    return this.#saving
  }

  private async writeCache() {
    try {
      const entries: Record<string, CacheEntry> = {}
      for (const [doi, entry] of Object.entries(this.#cache)) {
        entries[doi] = entry.feedback ? { ...entry, feedback: { ...entry.feedback, shown: {} } } : entry
      }
      const path = this.cachePath()
      await IOUtils.writeJSON(path, { version: 1, entries }, { tmpPath: `${path}.tmp` })
    }
    catch (err) {
      log.error('saveCache failed:', err)
    }
  }

  private async libraryDOIs(): Promise<string[]> {
    const query = `
      SELECT DISTINCT fields.fieldName, itemDataValues.value
      FROM fields
      JOIN itemData on fields.fieldID = itemData.fieldID
      JOIN itemDataValues on itemData.valueID = itemDataValues.valueID
      WHERE fieldname IN ('extra', 'DOI')
    `.replace(/[\s\n]+/g, ' ').trim()

    const dois = new Set<string>()
    for (const doi of (await Zotero.DB.queryAsync(query) as { fieldName: string; value: string }[])) {
      const value = doi.fieldName === 'extra' ? doi.value.match(/^DOI:\s*(.+)/im)?.[1] : doi.value
      if (value?.trim()) dois.add(value.trim().toLowerCase())
    }
    return [...dois]
  }

  // Looks up the expired part of the library, then schedules the next run
  private async refresh() {
    try {
      const dois = await this.libraryDOIs()

      // forget DOIs that left the library, so the cache does not grow forever
      const inLibrary = new Set(dois)
      for (const doi of Object.keys(this.#cache)) {
        if (!inLibrary.has(doi)) delete this.#cache[doi]
      }

      const now = Date.now()
      const expired = dois.filter(doi => !(this.#cache[doi]?.expires > now))
      log.debug('refresh:', expired.length, 'of', dois.length, 'DOIs expired')

      for (let i = 0; i < expired.length && !this.#stopped; i += CHUNK_SIZE) {
        if (!await this.request(expired.slice(i, i + CHUNK_SIZE))) break
        // save now and then, so a long first run is not lost if Zotero closes
        if ((i / CHUNK_SIZE) % 50 === 49) await this.saveCache()
      }

      this.refreshColumns(true)
      await this.saveCache()
    }
    catch (err) {
      log.error('refresh failed:', err)
    }
    finally {
      if (!this.#stopped) this.#refreshTimer = setTimeout(() => this.refresh(), REFRESH_INTERVAL)
    }
  }

  protected async notify(action: string, type: string, ids: number[], _extraData: any) {
    if (type !== 'item' || (action !== 'modify' && action !== 'add')) return

    const dois = (await Zotero.Items.getAsync(ids)).map(item => getDOI(item)).filter(_ => _)
    if (dois.length) await this.get(dois)
  }
}

export var PubPeer = Zotero.PubPeer = new $PubPeer() // eslint-disable-line no-var
