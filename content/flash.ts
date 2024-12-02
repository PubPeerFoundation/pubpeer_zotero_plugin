import { log } from './debug'
export function flash(title: string, body?: string, timeout = 4): void {
  try {
    log.debug('flash:', JSON.stringify({title, body}))
    const pw = new Zotero.ProgressWindow()
    pw.changeHeadline(`PubPeer: ${title}`)
    if (!body) body = title
    if (Array.isArray(body)) body = body.join('\n')
    pw.addDescription(body)
    pw.show()
    if (timeout) pw.startCloseTimer(timeout * 1000)
  }
  catch (err) {
    log.debug('flash failed:', JSON.stringify({title, body}), err.message)
  }
}
