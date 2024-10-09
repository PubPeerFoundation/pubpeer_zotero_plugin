// https://stackoverflow.com/questions/39040108/import-class-in-definition-file-d-ts
type $PubPeer = import('./pubpeer').$PubPeer
declare var PubPeer: $PubPeer
declare const Zotero: any
declare const AddonManager: any
declare const Components: any
declare const ZoteroPane: any
