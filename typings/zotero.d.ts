/* eslint-disable @typescript-eslint/no-explicit-any */
import { PubPeer } from '../content/pubpeer'

declare global {
  interface IZotero {
    PubPeer: PubPeer

    Styles: any
    Cite: any
    ProgressWindow: any
    Integration: any
    debug: any
    logError: any
    Prefs: any
    getActiveZoteroPane: any
    ItemTreeView: any
    Items: any
    Item: any
    DB: any
    HTTP: any
    Notifier: any
    Schema: any
    Promise: any
  }
}
