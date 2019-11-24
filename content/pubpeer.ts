Components.utils.import('resource://gre/modules/AddonManager.jsm')
declare const AddonManager: any

declare const Zotero: any
declare const Components: any

import { patch as $patch$ } from './monkey-patch'

interface Feedback {
  id: string // DOI
  title: string
  url: string
  total_comments: number
  users: string
  last_commented_at: Date
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
  } catch (err) {
    return ''
  }
}
function getDOI(doi, extra) {
  if (doi) return doi

  if (!extra) return ''

  const dois = extra.value.split('\n').map(line => line.match(/^DOI:\s*(.+)/i)).filter(line => line).map(line => line[1].trim())
  return dois[0] || ''
}

const itemTreeViewWaiting: Record<number, { image?: boolean, text?: boolean, properties?: boolean }> = {}

function getCellX(tree, row, col, field) {
  if (col.id !== 'zotero-items-column-pubpeer') return ''

  const item = tree.getRow(row).ref

  if (item.isNote() || item.isAttachment()) return ''

  if (PubPeer.ready.isPending()) { // tslint:disable-line:no-use-before-declare
    if (!itemTreeViewWaiting[item.id]?.[field]) {
      // tslint:disable-next-line:no-use-before-declare
      PubPeer.ready.then(() => tree._treebox.invalidateCell(row, col))
      itemTreeViewWaiting[item.id] = itemTreeViewWaiting[item.id] || {}
      itemTreeViewWaiting[item.id][field] = true
    }

    switch (field) {
      case 'image':
        return 'chrome://zotero-pubpeer/skin/loading.gif'
      case 'properties':
        return ' PubPeerLoading'
      case 'text':
        return ''
    }
  }

  const doi = getDOI(getField(item, 'DOI'), getField(item, 'extra'))
  if (!doi || !PubPeer.feedback[doi]) return ''

  switch (field) {
    case 'image':
      return `chrome://zotero-pubpeer/skin/pubpeer${Zotero.hiDPISuffix}.png`

    case 'text':
      return ' '

    case 'properties':
      return ' hasPubPeerComments'
  }
}

$patch$(Zotero.ItemTreeView.prototype, 'getCellProperties', original => function Zotero_ItemTreeView_prototype_getCellProperties(row, col, prop) {
  const props = (original.apply(this, arguments) + getCellX(this, row, col, 'properties')).trim()
  Zotero.debug(`getCellProperties: ${props}`)
  return props
})

$patch$(Zotero.ItemTreeView.prototype, 'getImageSrc', original => function Zotero_ItemTreeView_prototype_getImageSrc(row, col) {
  if (col.id !== 'zotero-items-column-pubpeer') return original.apply(this, arguments)

  Zotero.debug(`getImageSrc: ${getCellX(this, row, col, 'image')}`)

  return getCellX(this, row, col, 'image')
})

$patch$(Zotero.ItemTreeView.prototype, 'getCellText', original => function Zotero_ItemTreeView_prototype_getCellText(row, col) {
  if (col.id !== 'zotero-items-column-pubpeer') return original.apply(this, arguments)

  return getCellX(this, row, col, 'text')
})

// To show the citekey in the reference list
$patch$(Zotero.Item.prototype, 'getField', original => function Zotero_Item_prototype_getField(field, unformatted, includeBaseMapped) {
  try {
    if (field === 'pubpeer') {
      if (PubPeer.ready.isPending()) return '' // tslint:disable-line:no-use-before-declare
      const doi = getDOI(getField(this, 'DOI'), getField(this, 'extra'))
      if (!doi || !PubPeer.feedback[doi]) return ''
      return ' '
    }
  } catch (err) {
    Zotero.logError(`pubpeer patched getField: ${err}`)
    return ''
  }

  return original.apply(this, arguments)
})

const ready = Zotero.Promise.defer()

export let PubPeer = new class { // tslint:disable-line:variable-name
  // public ready: Promise<boolean> = ready.promise
  public ready: any = ready.promise
  public feedback: { [DOI: string]: Feedback } = {}
  public uninstalled: boolean = false

  private bundle: any
  private started = false

  constructor() {
    this.bundle = Components.classes['@mozilla.org/intl/stringbundle;1'].getService(Components.interfaces.nsIStringBundleService).createBundle('chrome://zotero-pubpeer/locale/zotero-pubpeer.properties')
  }

  public async start() {
    if (this.started) return
    this.started = true

    await Zotero.Schema.schemaUpdatePromise
    await this.refresh()
    ready.resolve(true)

    Zotero.Notifier.registerObserver(this, ['item'], 'PubPeer', 1)
  }

  public getString(name, params = {}, html = false) {
    if (!this.bundle || typeof this.bundle.GetStringFromName !== 'function') {
      Zotero.logError(`PubPeer.getString(${name}): getString called before strings were loaded`)
      return name
    }

    let template = name

    try {
      template = this.bundle.GetStringFromName(name)
    } catch (err) {
      Zotero.logError(`PubPeer.getString(${name}): ${err}`)
    }

    Zotero.debug(`PubPeer.getString(${name}): ${JSON.stringify(template)} ${JSON.stringify(params)}`)
    const encode = html ? htmlencode : plaintext
    return template.replace(/{{(.*?)}}/g, (match, param) => encode(params[param] || ''))
  }

  public async get(dois, options: { refresh?: boolean } = {}) {
    const fetch = options.refresh ? dois : dois.filter(doi => !this.feedback[doi])

    if (fetch.length) {
      try {
        const pubpeer = await Zotero.HTTP.request('POST', 'https://pubpeer.com/v3/publications?devkey=PubPeerZotero', {
          body: JSON.stringify({ dois: fetch }),
          responseType: 'json',
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        })

        Zotero.debug(`PubPeer.get(${fetch}): ${JSON.stringify(pubpeer?.response || {})}`)

        for (const feedback of (pubpeer?.response?.feedbacks || [])) {
          if (feedback.last_commented_at.timezone !== 'UTC') Zotero.debug(`PubPeer.get: ${feedback.id} has timezone ${feedback.last_commented_at.timezone}`)
          this.feedback[feedback.id] = {...feedback, last_commented_at: new Date(feedback.last_commented_at.date + 'Z') }
        }
      } catch (err) {
        Zotero.debug(`PubPeer.get(${fetch}): ${err}`)
      }
    }

    return dois.map(doi => this.feedback[doi])
  }

  private async refresh() {
    const query = `
      SELECT DISTINCT fields.fieldName, itemDataValues.value
      FROM fields
      JOIN itemData on fields.fieldID = itemData.fieldID
      JOIN itemDataValues on itemData.valueID = itemDataValues.valueID
      WHERE fieldname IN ('extra', 'DOI')
    `.replace(/[\s\n]+/g, ' ').trim()

    let dois = []
    for (const doi of await Zotero.DB.queryAsync(query)) {
      switch (doi.fieldName) {
        case 'extra':
          dois = dois.concat(doi.value.split('\n').map(line => line.match(/^DOI:\s*(.+)/i)).filter(line => line).map(line => line[1].trim()))
          break
        case 'DOI':
          dois.push(doi.value)
          break
      }
    }

    await this.get(dois, { refresh: true })

    setTimeout(this.refresh.bind(this), 24 * 60 * 60 * 1000) // tslint:disable-line:no-magic-numbers
  }

  protected async notify(action, type, ids, extraData) {
    if (type !== 'item' || action !== 'modify' && action !== 'add') return

    const dois = []
    for (const item of (await Zotero.Items.getAsync(ids))) {
      const doi = getDOI(getField(item, 'DOI'), getField(item, 'extra'))
      if (doi && !dois.includes(doi)) dois.push(doi)
    }
    if (dois.length) await this.get(dois)
  }
}

// used in zoteroPane.ts
AddonManager.addAddonListener({
  onUninstalling(addon, needsRestart) {
    if (addon.id === 'pubpeer@pubpeer.com') PubPeer.uninstalled = true
  },

  onDisabling(addon, needsRestart) { this.onUninstalling(addon, needsRestart) },

  onOperationCancelled(addon, needsRestart) {
    if (addon.id !== 'pubpeer@pubpeer.com') return null

    // tslint:disable-next-line:no-bitwise
    if (addon.pendingOperations & (AddonManager.PENDING_UNINSTALL | AddonManager.PENDING_DISABLE)) return null

    delete Zotero.PubPeer.uninstalled
  },
})
