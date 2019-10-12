declare const Zotero: any
declare const Components: any

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

const ready = Zotero.Promise.defer()

export let PubPeer = new class { // tslint:disable-line:variable-name
  public ready: Promise<boolean> = ready.promise
  public feedback: { [itemID: string]: Feedback } = {}

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
}
