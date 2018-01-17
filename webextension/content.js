// signTextJS plus WebExtension front end
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

function signText(text, options, ...CAs) {
	let result = null;

	signTextAsync(text, options, r => {
		result = r;
	}, ...CAs);

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

function signTextAsync(text, options, resolve, ...CAs) {
	let detail = {
		CAs: CAs,
		data: stringToBytesToBase64(text),
		hostname: location.hostname,
		options: options,
		protocol: location.protocol,
		text: text
	};

	browser.runtime.sendMessage({
		event: "signText",
		detail: detail
	}).then(
		response => {
			let result = response.result;
			if (result == null) {
				result = ERROR_INTERNAL;
				log("No result");
			}
			resolve(result);
		},
		error => {
			log(error);
			resolve(ERROR_INTERNAL);
		}
	);
}

exportFunction(signText, window.crypto, {defineAs: "signText"});
exportFunction(signTextAsync, window.crypto, {defineAs: "signTextAsync"});
