import { debug } from './debug'

const strings = new Localization(['better-bibtex.ftl'], true)

export function localize(id_with_branch: string, params: any = null): string {
  try {
    if (id_with_branch.includes('.')) {
      const [ id, branch ] = id_with_branch.split('.')
      const messages = strings.formatMessagesSync([{ id, args: params || {}}])
      return messages[0].attributes[0][branch] as string
    }
    else {
      return strings.formatValueSync(id_with_branch, params || {}) as string
    }
  }
  catch (err) {
    debug(`l10n.get error: ${id_with_branch} (${err})`)
    return `!${ id_with_branch }`
  }
}
