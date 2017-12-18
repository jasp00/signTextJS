// signTextJS plus options
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

function saveOptions(e) {
	e.preventDefault();
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

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("form").addEventListener("submit", saveOptions);
