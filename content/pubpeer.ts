/* eslint-disable prefer-arrow/prefer-arrow-functions */

Components.utils.import('resource://gre/modules/AddonManager.jsm')
declare const AddonManager: any

declare const Zotero: IZotero
declare const ZoteroPane: any
declare const Components: any

import { patch as $patch$ } from './monkey-patch'
import { debug } from './debug'
import { ItemPane } from './itemPane'
import { ZoteroPane as ZoteroPaneHelper } from './zoteroPane'
import { DebugLog as DebugLogSender } from 'zotero-plugin/debug-log'

const seconds = 1000

// eslint-disable-next-line no-magic-numbers
export function flash(title: string, body?: string, timeout = 0): void {
  try {
    debug('flash:', JSON.stringify({title, body}))
    const pw = new Zotero.ProgressWindow()
    pw.changeHeadline(`PubPeer: ${title}`)
    if (!body) body = title
    if (Array.isArray(body)) body = body.join('\n')
    pw.addDescription(body)
    pw.show()
    if (timeout) pw.startCloseTimer(timeout * seconds)
  }
  catch (err) {
    debug('flash failed:', JSON.stringify({title, body}), err.message)
  }
}

interface Feedback {
  id: string // DOI
  title: string
  url: string
  total_comments: number
  users: string[]
  last_commented_at: Date
  shown: Record<string, boolean>
}

function htmlencode(text) {
  return `${text}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function plaintext(text) {
  return `${text}`
}

function getField(item, field) {
  try {
    return item.getField(field) || ''
  }
  catch (err) {
    return ''
  }
}
function getDOI(item): string {
  const doi: string = getField(item, 'DOI')
  if (doi) return doi

  const extra = getField(item, 'extra')
  if (!extra) return ''

  const dois: string[] = extra.split('\n')
    .map((line: string) => line.match(/^DOI:\s*(.+)/i))
    .filter((line: string) => line)
    .map((line: string) => line[1].trim())
  return dois[0] || ''
}

debug('table mode', typeof Zotero.ItemTreeView === 'undefined' ? 'new' : 'old')
if (typeof Zotero.ItemTreeView === 'undefined') {
  const itemTree = require('zotero/itemTree')

  $patch$(itemTree.prototype, 'getColumns', original => function Zotero_ItemTree_prototype_getColumns() {
    const columns = original.apply(this, arguments)
    // const insertAfter: number = columns.findIndex(column => column.dataKey === 'title')
    columns.push(/* splice(insertAfter + 1, 0, */{
      dataKey: 'pubpeer',
      label: 'PubPeer',
      flex: '1',
      zoteroPersist: new Set(['width', 'ordinal', 'hidden', 'sortActive', 'sortDirection']),
    })

    return columns
  })

  $patch$(itemTree.prototype, '_renderCell', original => function Zotero_ItemTree_prototype_renderCell(index, data, col) {
    if (col.dataKey !== 'pubpeer') return original.apply(this, arguments)

    const content = document.createElementNS('http://www.w3.org/1999/xhtml', 'span')
    content.className = 'cell-text'

    const cell = document.createElementNS('http://www.w3.org/1999/xhtml', 'span')
    cell.className = `cell ${col.className}`
    cell.append(content)

    let feedback

    const item = this.getRow(index).ref
    if (item.isRegularItem()) {
      if (Zotero.PubPeer.ready.isPending()) {
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
}
else {
  const itemTreeViewWaiting: Record<string, boolean> = {}

  function getCellX(tree, row, col, field): string { // eslint-disable-line no-inner-declarations
    if (col.id !== 'zotero-items-column-pubpeer') return ''

    const item = tree.getRow(row).ref

    if (item.isNote() || item.isAttachment()) return ''

    if (Zotero.PubPeer.ready.isPending()) {
      const id = `${field}.${item.id}`
      if (!itemTreeViewWaiting[id]) {
        Zotero.PubPeer.ready
          .then(() => {
            tree._treebox.invalidateCell(row, col) // eslint-disable-line no-underscore-dangle
          })
          .catch(err => {
            Zotero.logError(err)
          })
        itemTreeViewWaiting[id] = true
      }

      switch (field) {
        case 'image':
          return 'chrome://zotero-pubpeer/skin/loading.gif'
        case 'properties':
          return ' pubpeer-state-loading'
        case 'text':
          return ''
      }
    }

    const feedback = Zotero.PubPeer.feedback[getDOI(item)]
    if (!feedback) return ''

    let state
    switch (field) {
      case 'text':
        return `${feedback.total_comments}` // last_commented_at.toISOString().replace(/T.*/, '')

      case 'properties':
        state = feedback.users.map(user => Zotero.PubPeer.users[user])
        if (state.includes('priority')) return ' pubpeer-state-highlighted'
        if (state.includes('neutral')) return ' pubpeer-state-neutral'
        return ' pubpeer-state-muted'
    }
  }

  $patch$(Zotero.ItemTreeView.prototype, 'getCellProperties', original => function Zotero_ItemTreeView_prototype_getCellProperties(row, col, _prop) {
    return (original.apply(this, arguments) as string + getCellX(this, row, col, 'properties')).trim()
  })

  $patch$(Zotero.ItemTreeView.prototype, 'getCellText', original => function Zotero_ItemTreeView_prototype_getCellText(row, col): string {
    if (col.id !== 'zotero-items-column-pubpeer') return original.apply(this, arguments) as string

    return getCellX(this, row, col, 'text')
  })
}

$patch$(Zotero.Item.prototype, 'getField', original => function Zotero_Item_prototype_getField(field, _unformatted, _includeBaseMapped): string {
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

$patch$(Zotero.Integration.Session.prototype, 'addCitation', original => async function(index, noteIndex, citation) {
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

const ready = Zotero.Promise.defer()

export class PubPeer {
  public ItemPane = new ItemPane
  public ZoteroPane = new ZoteroPaneHelper

  public ready: Promise<boolean> & { isPending: () => boolean } = ready.promise
  // public ready: any = ready.promise
  public feedback: { [DOI: string]: Feedback } = {}
  public users: Record<string, 'neutral' | 'priority' | 'muted'> = this.load()
  public uninstalled = false

  private bundle: any
  private started = false

  constructor() {
    this.bundle = Components.classes['@mozilla.org/intl/stringbundle;1'].getService(Components.interfaces.nsIStringBundleService).createBundle('chrome://zotero-pubpeer/locale/zotero-pubpeer.properties')
  }

  public load(): Record<string, 'neutral' | 'priority' | 'muted'> {
    try {
      return JSON.parse(Zotero.Prefs.get('pubpeer.users') || '{}') as Record<string, 'neutral' | 'priority' | 'muted'>
    }
    catch (err) {
      return {}
    }
  }

  public save() {
    Zotero.Prefs.set('pubpeer.users', JSON.stringify(this.users))
  }

  public async start() {
    if (this.started) return
    this.started = true

    await Zotero.Schema.schemaUpdatePromise
    await this.refresh()
    ready.resolve(true)
    if (typeof Zotero.ItemTreeView === 'undefined') ZoteroPane.itemsView.refreshAndMaintainSelection()

    Zotero.Notifier.registerObserver(this, ['item'], 'PubPeer', 1)

    DebugLogSender.register('PubPeer', [])
  }

  public getString(name: string, params = {}, html = false) {
    if (!this.bundle || typeof this.bundle.GetStringFromName !== 'function') {
      Zotero.logError(`PubPeer.getString(${name}): getString called before strings were loaded`)
      return name
    }

    let template = name

    try {
      template = this.bundle.GetStringFromName(name)
    }
    catch (err) {
      Zotero.logError(`PubPeer.getString(${name}): ${err}`)
    }

    const encode: (t: string) => string = html ? htmlencode : plaintext
    return template.replace(/{{(.*?)}}/g, (_match, param: string) => encode(params[param] || ''))
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
            last_commented_at: new Date(feedback.last_commented_at.date as string + 'Z'), // eslint-disable-line prefer-template
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

    setTimeout(this.refresh.bind(this), 24 * 60 * 60 * 1000) // eslint-disable-line @typescript-eslint/no-magic-numbers
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

Zotero.PubPeer = Zotero.PubPeer || new PubPeer

// used in zoteroPane.ts
AddonManager.addAddonListener({
  onUninstalling(addon, _needsRestart) {
    if (addon.id === 'pubpeer@pubpeer.com') Zotero.PubPeer.uninstalled = true
  },

  onDisabling(addon, needsRestart) { this.onUninstalling(addon, needsRestart) },

  onOperationCancelled(addon, _needsRestart) {
    if (addon.id !== 'pubpeer@pubpeer.com') return null

    if (addon.pendingOperations & (AddonManager.PENDING_UNINSTALL | AddonManager.PENDING_DISABLE)) return null // eslint-disable-line no-bitwise

    delete Zotero.PubPeer.uninstalled
  },
})
