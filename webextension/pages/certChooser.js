// Certificate chooser
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

let certArray = [];

function fillWithInfo(info) {
// i18n is broken in Firefox 52 and 57
//	document.getElementById("headline").textContent
//		= browser.i18n.getMessage("headline", info.hostname);
	document.getElementById("headline").textContent
		= "The site '$hostname$' has requested that you sign the following text message:".replace("$hostname$", info.hostname);
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
/*data.l10n["subject"]*/"Issued to:" + ` ${cert.subject}
  ` + /*data.l10n["serial"]*/"Serial Number:" + ` ${cert.serialNumber}
  ` + /*data.l10n["valid_from"]*/"Valid from" + ` ${cert.notBefore} `
+ /*data.l10n["to"]*/"to" + ` ${cert.notAfter}
  ` + /*data.l10n["key_usage"]*/"Certificate Key Usage:" + ` ${cert.usage}
  ` + /*data.l10n["email"]*/"Email:" + ` ${cert.email}
` + /*data.l10n["issuer"]*/"Issued by:" + ` ${cert.issuer}
` + /*data.l10n["token"]*/"Stored in:" + ` ${cert.token}`;
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

//document.getElementById("title").textContent = browser.i18n.getMessage("title");
document.getElementById("title").textContent = "Text Signing Request";
document.getElementById("caption").textContent = "Signing Certificate";
document.getElementById("confirm").textContent = "To confirm you agree to sign this text message using your selected certificate, please confirm by entering the master password:";
document.getElementById("btnCancel").textContent = "Cancel";
document.getElementById("btnOK").textContent = "OK";
