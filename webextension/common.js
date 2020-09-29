// signTextJS plus WebExtension common bits
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

const ERROR_NO_MATCHING_CERT = "error:noMatchingCert";
const ERROR_USER_CANCEL = "error:userCancel";
const ERROR_INTERNAL = "error:internalError";
const ERROR_AUTHENTICATION_FAILED = "error:authenticationFailed";

let WEOptions_debug = true;
let WEOptions_invalid = false;

function log(s) {
	if (WEOptions_debug)
		console.log(`SignText: ${s}`);
}

browser.storage.local.get({debug: false, invalid: false}).then(
	(result) => {
		WEOptions_debug = result.debug;
		WEOptions_invalid = result.invalid;
	},
	(error) => {
		log(error);
	}
);

function updateWEOptions(changes, areaName) {
	if (areaName != "local")
		return;

	if (changes.debug)
		WEOptions_debug = changes.debug.newValue;
	if (changes.invalid)
		WEOptions_invalid = changes.invalid.newValue;
}

browser.storage.onChanged.addListener(updateWEOptions);
