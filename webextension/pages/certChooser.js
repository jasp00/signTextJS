// Certificate chooser
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

let _ = browser.i18n.getMessage;

let certArray = [];

function fillWithInfo(info) {
// i18n is broken in Firefox 52 and 57
	document.getElementById("headline").textContent
		= _("headline", info.hostname);
	let textArea = document.getElementById("text");
	textArea.textContent = info.text;
	let certDisplayNames = document.getElementById("certDisplayNames");
	for (let cert of info.certs) {
		let option = document.createElement("option");
		option.setAttribute("value", cert.der);
		option.textContent = cert.displayName;
		certDisplayNames.appendChild(option);
		certArray[cert.der] = cert;
	}
	if (info.certificate)
		certDisplayNames.value = info.certificate.der;
}

function displayCertDetails() {
	let selection = document.getElementById("certDisplayNames");
	let cert = certArray[selection.value];
	let detailsElement = document.getElementById("certDetails");
	detailsElement.textContent =
`${_("subject")} ${cert.subject}
  ${_("serial")} ${cert.serialNumber}
  ${_("valid_from")} ${cert.notBefore} ${_("to")} ${cert.notAfter}
  ${_("key_usage")} ${cert.usage}
  ${_("email")} ${cert.email}
${_("issuer")} ${cert.issuer}
${_("token")} ${cert.token}`;
}

function doOK() {
	let selection = document.getElementById("certDisplayNames");
	let detail = {
		certificate: certArray[selection.value],
		password: document.getElementById("certPassword").value
	};
	browser.runtime.sendMessage({
		event: "certChooserResult",
		detail: detail
	}).then(
		(response) => {
			window.close();
		}
	);
}

function doCancel() {
	window.close();
}

browser.runtime.sendMessage({
	event: "getCertChooserInfo"
}).then(
	(response) => {
		fillWithInfo(response);
		displayCertDetails();
		document.getElementById("certDisplayNames")
			.addEventListener("change", displayCertDetails);
		document.getElementById("btnOK")
			.addEventListener("click", doOK);
		document.getElementById("btnCancel")
			.addEventListener("click", doCancel);
		document.getElementById("certPassword").focus();
	}
);

function keyboardListener(e) {
	if (e.keyCode === 13) // Enter
		doOK();
	else if (e.keyCode === 27) // Escape
		doCancel();
}

document.addEventListener("keydown", keyboardListener);

document.getElementById("title").textContent = _("title");
document.getElementById("caption").textContent = _("caption");
document.getElementById("confirm").textContent = _("confirm");
document.getElementById("btnCancel").textContent = _("cancel");
document.getElementById("btnOK").textContent = _("ok");
