// Inject signText and signTextAsync into document
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+

window.addEventListener("signText", function(event) {
	self.port.emit("signText", event.detail);
});

self.port.on("signText-result", function(result) {
	let event = new CustomEvent("signText-result",
		{bubbles: true, detail: result});
	document.documentElement.dispatchEvent(event);
});

window.addEventListener("signText-ack", function(event) {
	self.port.emit("signText-ack", event.detail);
});

let script = document.createElement("script");
script.type = "application/javascript";
script.text =
	// TODO: Resolve per task
	"let gResolve = null;" +

	"window.addEventListener('signText-result', function(event) {" +
		"gResolve(event.detail);" +
	"});" +

	// signTextVA is private
	"window.crypto.signTextVA = function(signTextArgs, sync) {" +
		"let context = {" +
			"arguments: signTextArgs," +
			"characterSet: document.characterSet," +
			"location: location," +
			"synchronize: sync" +
		"};" +
		"let event = new CustomEvent('signText'," +
			"{bubbles: true, detail: context});" +

		"let fulfillment = new Promise(function(resolve, reject) {" +
			"gResolve = resolve;" +
			"document.documentElement.dispatchEvent(event);" +
		"});" +

		"return fulfillment;" +
	"};" +

	"window.crypto.signText = function(text, caOption) {" +
		// TODO: emit task token
		"let result = null;" +
		"let promise = window.crypto.signTextVA(arguments, true);" +
		"promise.then(function(aResult) {" +
			"result = aResult;" +
			"let event = new CustomEvent('signText-ack'," +
				"{bubbles: true, detail: text});" +
			"document.documentElement.dispatchEvent(event);" +
		"});" +

		"let request = new XMLHttpRequest();" +
		// TODO: Add task token
		"request.open('GET', 'http://127.0.0.1:" + self.options.port +
			"', false);" +
		"request.send();" +

		"return result;" +
	"};" +

	"window.crypto.signTextAsync = function(text, caOption) {" +
		"return window.crypto.signTextVA(arguments, false);" +
	"};";

function injectScript(event) {
	document.removeEventListener("beforescriptexecute", injectScript);
	document.documentElement.appendChild(script);
}

document.addEventListener("beforescriptexecute", injectScript);
