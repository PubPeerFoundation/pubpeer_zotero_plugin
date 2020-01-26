import { CPubPeer } from '../content/pubpeer'

declare global {
  interface IZotero {
    PubPeer: CPubPeer

    debug(msg: string)
    logError(err: Error | string)

    getActiveZoteroPane(): any

    Notifier: {
      trigger(event: string, type: string, itemIDs: number[])
      registerObserver(onserver: any, types: string[], id: string, priority?: number) // any => ZoteroObserver
      unregisterObserver(id: number)
    }

    Prefs: {
      get(pref: string)
      set(pref: string, value: string | number | boolean)
    }

    Items: {
      async getAsync(ids: number | number[]): any | any[]
    }

    DB: {
      async queryAsync(query: string): any[]
    }

    HTTP: {
      async request(method: string, url: string, options?: {
        body?: string,
        responseType?: string,
        headers?: Record<string, string>,
      })
    }

    Schema: {
      schemaUpdatePromise: Promise<boolean>
    }

    Promise: Promise

    static ItemTreeView: {
      new (): {}
      getCellText(row: number, col: number)
    }

    static Item: {
      new (): {}
      getField(field: string, unformatted: boolean, includeBaseMapped: boolean): string
    }
  }
}
