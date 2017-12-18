// signTextJS plus WebExtension front end
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

function signTextVA(signTextArgs, sync) {
	let args = [];
	for (let i = 0; i < signTextArgs.length; i++)
		args[i] = signTextArgs[i];
	let detail = {
		arguments: args,
		data: stringToBytesToBase64(args[0]),
		hostname: location.hostname,
		protocol: location.protocol,
		sync: sync
	};
	return browser.runtime.sendMessage({
		event: "signText",
		detail: detail
	});
}

function signText(text, options) {
	let result = null;
	signTextVA(arguments, true).then(
		function(response) {
			result = response.result;
			if (result == null) {
				result = ERROR_INTERNAL;
				log("No result");
			}
		},
		function(error) {
			result = ERROR_INTERNAL;
			log(error);
		}
	);

	if (result == null)
		alert(
`signText running...
Please consider using signTextAsync.

Close this window when signing has finished.`
		);

	if (result == null)
		alert(
`signText still running...

Closing this window too soon will cancel the operation.`
		);

	if (result == null)
		result = ERROR_USER_CANCEL;

	return result;
}

function signTextAsync(text, options, resolve) {
	signTextVA(arguments, false).then(
		(response) => {
			let result = response.result;
			if (result == null) {
				result = ERROR_INTERNAL;
				log("No result");
			}
			resolve(result);
		},
		(error) => {
			log(error);
			resolve(ERROR_INTERNAL);
		}
	);
}

exportFunction(signText, window.crypto, {defineAs:'signText'});
exportFunction(signTextAsync, window.crypto, {defineAs:'signTextAsync'});
