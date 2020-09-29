// signTextJS plus options
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

let _ = browser.i18n.getMessage;

function saveDebug(e) {
	browser.storage.local.set({
		debug: document.getElementById("debug").checked
	});
}

function saveInvalid(e) {
	browser.storage.local.set({
		invalid: document.getElementById("invalid").checked
	});
}

function restoreOptions() {
	browser.storage.local.get({debug: false, invalid: false}).then(
		(result) => {
			document.getElementById("debug").checked = result.debug;
			document.getElementById("invalid").checked
				= result.invalid;
		},
		(error) => {
			console.log(`Error: ${error}`);
		}
	);
}

restoreOptions();

document.getElementById("debug").addEventListener("change", saveDebug);
document.getElementById("invalid").addEventListener("change", saveInvalid);

document.getElementById("debug_title").textContent = _("debug_title");
document.getElementById("debug_title").title = _("debug_description");
document.getElementById("invalid_title").textContent = _("invalid_title");
document.getElementById("invalid_title").title = _("invalid_description");
