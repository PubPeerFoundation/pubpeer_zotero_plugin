// Only create main object once
if (!Zotero.ZoteroPubPeer) {
	let loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
					.getService(Components.interfaces.mozIJSSubScriptLoader);
	loader.loadSubScript("chrome://zoteropubpeer/content/zoteropubpeer.js");
}
