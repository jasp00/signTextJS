// signTextJS plus options
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

let _ = browser.i18n.getMessage;

function saveOptions(e) {
	browser.storage.local.set({
		debug: document.getElementById("debug").checked
	});
}

function restoreOptions() {
	browser.storage.local.get({debug: false}).then(
		(result) => {
			document.getElementById("debug").checked = result.debug;
		},
		(error) => {
			console.log(`Error: ${error}`);
		}
	);
}

restoreOptions();

document.getElementById("debug").addEventListener("change", saveOptions);

document.getElementById("debug_title").textContent = _("debug_title");
document.getElementById("debug_title").title = _("debug_description");
