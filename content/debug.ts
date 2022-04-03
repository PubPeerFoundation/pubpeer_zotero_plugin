declare const Zotero: IZotero

function to_s(obj: any): string {
  if (typeof obj === 'string') return obj
  const s = `${obj}`
  switch (s) {
    case '[object Object]':
      return JSON.stringify(obj)
    case '[object Set]':
      return JSON.stringify(Array.from(obj))
    default:
      return s
  }
}

export function debug(...msg): void {
  const str = `Cite Columns: ${msg.map(to_s).join(' ')}`
  Zotero.debug(str)
}
