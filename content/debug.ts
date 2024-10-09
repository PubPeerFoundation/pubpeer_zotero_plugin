function replacer(key, value) {
  if (value === null) return value
  if (value instanceof Set) return [...value]
  if (value instanceof Map) return Object.fromEntries(value)
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
      return value
  }
  if (Array.isArray(value)) return value
  return undefined
}

function to_s(obj: any): string {
  if (typeof obj === 'string') return obj
  return JSON.stringify(obj, replacer)
}

export function debug(...msg): void {
  Zotero.debug(`PubPeer: ${msg.map(to_s).join(' ')}`)
}

function circularReplacer() {
    const seen = new Set();
    return function(key, value) {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular]';
            }
            seen.add(value);
        }
        return value;
    };
}
