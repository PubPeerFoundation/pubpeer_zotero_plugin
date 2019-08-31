Zotero.ZoteroPubPeer = {
	prompt: Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
			.getService(Components.interfaces.nsIPromptService),

	sayHello: function() {
		this.prompt.alert(null, "This is a test", "This is PubPeer");
	},
	
	sayGoodBye: function() {
		this.prompt.alert(null, this.getStr('zoteropubpeer-popup-title'), this.getStr('zoteropubpeer-popup-content', 'test', '0'));
	},
	
	/**
	* Returns a localized string
	*
	* @param {string} msg - The name of the string to get
	* @param {string[]} [optionalValue] - parameters to be inserted into the resulting string
	* @return {string} - localized string
	*
	* function from:
	* https://developer.mozilla.org/en-US/docs/Archive/Add-ons/Code_snippets/Miscellaneous#Using_string_bundles_from_JavaScript
	*/
	fcBundle: Components.classes["@mozilla.org/intl/stringbundle;1"]
               .getService(Components.interfaces.nsIStringBundleService)
               .createBundle("chrome://zoteropubpeer/locale/zoteropubpeer.properties"),
	getStr: function(msg, args){
	  if (args){
		args = Array.prototype.slice.call(arguments, 1);
		return this.fcBundle.formatStringFromName(msg,args,args.length);
	  } else {
		return this.fcBundle.GetStringFromName(msg);
	  }
	},
	
	getPubPeerLink: function() {
		var
			url = "https://pubpeer.com",
			address = `${url}/v3/publications?devkey=PubMedFirefox`;
			
		let request_content =JSON.stringify({
			dois: [this.getSelectedItemDOI()],
			version: "0.3.4",
			browser: "Firefox"
		});
		
		let request = new XMLHttpRequest();
		request.open('POST', address, true);
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
		request.onload = this.onReqLoad;
		request.send(request_content);
	},
	
	onReqLoad: function () {
		if (this.status >= 200 && this.status < 400) {
			let responseText = JSON.parse(this.responseText);
			if (!responseText) {
				return;
			}
			var ps = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
				.getService(Components.interfaces.nsIPromptService);
			var N_comments = (responseText.feedbacks.length>0 ? responseText.feedbacks[0].total_comments : 0);
			var N_comments_text = (N_comments > 1 ? `${N_comments} comments` : `${N_comments} comment`);
			var output = `The selected item has ${N_comments_text} on PubPeer`;
			if (N_comments>0) {
				output += `\n${responseText.feedbacks[0].url}`;
			}
			ps.alert(null, "Results from PubPeer", output);
			//This item (doi: ${responseText.feedbacks[0].id})\nhas ${responseText.feedbacks[0].total_comments} on PubPeer\n${responseText.feedbacks[0].url}`);
		}
	},
	
	getSelectedItemDOI: function() {
		var ZoteroPane = Zotero.getActiveZoteroPane();
		// Get first selected item
		var selectedItems = ZoteroPane.getSelectedItems();
		var item = selectedItems[0];
		 
		// Proceed if an item is selected and it isn't a note
		if (item.isRegularItem()) {
			return item.getField('DOI');
		} else {
			return "";
		}
	}
};
