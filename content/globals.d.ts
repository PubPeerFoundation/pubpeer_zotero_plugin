// https://stackoverflow.com/questions/39040108/import-class-in-definition-file-d-ts
type $PubPeer = import('./pubpeer').$PubPeer
declare var PubPeer: $PubPeer // eslint-disable-line no-var
declare const Zotero: { PubPeer: $PubPeer } & Omit<Record<string, any>, 'PubPeer'>
declare const AddonManager: any
declare const Components: any
declare const Services: any
declare const Localization: any
