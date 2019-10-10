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

export let PubPeer = new class { // tslint:disable-line:variable-name
  private feedback: { [itemID: string]: Feedback } = {}
  private bundle: any

  constructor() {
    this.bundle = Components.classes['@mozilla.org/intl/stringbundle;1'].getService(Components.interfaces.nsIStringBundleService).createBundle('chrome://zotero-pubpeer/locale/zotero-pubpeer.properties')
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

    const encode = html ? htmlencode : plaintext
    return template.replace(/{{(.*?)}}/g, (match, param) => encode(params[param] || ''))
  }

  public async get(dois, refresh = false) {
    const fetch = refresh ? dois : dois.filter(doi => !this.feedback[doi])

    const pubpeer = await Zotero.HTTP.request('POST', 'https://pubpeer.com/v3/publications?devkey=PubPeerZotero', {
      body: JSON.stringify({ dois: fetch }),
      responseType: 'json',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    })

    Zotero.debug(`PubPeer.get(${fetch}): ${JSON.stringify(pubpeer?.response || {})}`)

    for (const feedback of (pubpeer?.response?.feedbacks || [])) {
      if (feedback.last_commented_at.timezone !== 'UTC') Zotero.debug(`PubPeer.get: ${feedback.id} has timezone ${feedback.last_commented_at.timezone}`)
      this.feedback[feedback.id] = {...feedback, last_commented_at: Date.parse(feedback.last_commented_at.date + 'Z') }
    }

    return dois.map(doi => this.feedback[doi])
  }
}
