import { debug } from './debug'
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
    if (timeout) pw.startCloseTimer(timeout * 1000)
  }
  catch (err) {
    debug('flash failed:', JSON.stringify({title, body}), err.message)
  }
}
