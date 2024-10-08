declare const Zotero: any

import { log } from './content/log'

export async function startup({ id, version, rootURI }) {
	log("Starting 2.0");
	
	Zotero.PreferencePanes.register({
		pluginID: 'make-it-red@example.com',
		src: rootURI + 'preferences.xhtml',
		scripts: [rootURI + 'preferences.js']
	});
	
	Services.scriptloader.loadSubScript(rootURI + 'make-it-red.js');
	MakeItRed.init({ id, version, rootURI });
	MakeItRed.addToAllWindows();
	await MakeItRed.main();
}

export function onMainWindowLoad({ window }) {
	MakeItRed.addToWindow(window);
}

export function onMainWindowUnload({ window }) {
	MakeItRed.removeFromWindow(window);
}

export function shutdown() {
	log("Shutting down 2.0");
	MakeItRed.removeFromAllWindows();
	MakeItRed = undefined;
}

export function uninstall() {
	log("Uninstalled 2.0");
}
