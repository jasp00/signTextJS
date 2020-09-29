// signTextJS plus WebExtension back end
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

const WebExtensionVersion = browser.runtime.getManifest().version;

function hasOption(options, o) {
	return options.match(RegExp("(^| +)" + o + "( +|$)"));
}

let chooserSlots = [];

function newChooserSlot() {
	let i;
	for (i = 0; i < chooserSlots.length; i++)
		if (chooserSlots[i] == null)
			break;
	chooserSlots[i] = {};
	return i;
}

function freeChooserSlot(index) {
	chooserSlots[index] = null;
}

function slotFromId(id) {
	for (let i = 0; i < chooserSlots.length; i++)
		if (chooserSlots[i] && chooserSlots[i].id == id)
			return i;
	return -1;
}

function slotFromPort(port) {
	for (let i = 0; i < chooserSlots.length; i++)
		if (chooserSlots[i] && chooserSlots[i].port === port)
			return i;
	return -1;
}

function noZeroMicroseconds(certs) {
	for (let cert of certs) {
		cert.notBefore = cert.notBefore.replace(",000000", "");
		cert.notAfter = cert.notAfter.replace(",000000", "");
	}
}

function commonOrFullName(s) {
	let token = s.match(/CN="[^"]*"/)
	if (token) {
		let name = token[0].slice(4, -1);
		if (name == "")
			return s;
		return name;
	}
	token = s.match(/CN=[^,]+/)
	if (token)
		return token[0].slice(3);
	return s;
}

const DN_NONE = 0;
const DN_SUBJECT = 1;
const DN_SUBJECT_ISSUER = 2;
const DN_SUBJECT_ISSUER_TIME = 3;
const DN_SUBJECT_ISSUER_TIME_COUNTER = 4;

function getDisplayName(info) {
	switch (info.mode) {
	case DN_SUBJECT:
		return info.subject;
	case DN_SUBJECT_ISSUER:
		return `${info.subject} (${info.issuer})`;
	case DN_SUBJECT_ISSUER_TIME:
		return `${info.subject} (${info.issuer}; ${info.date})`;
	}
	return `${info.subject} (${info.issuer}; ${info.date}) #${info.id}`;
}

function fillDisplayNames(certs) {
	let info = [];

	for (let i = 0; i < certs.length; i++) {
		let cert = certs[i];
		info[i] = {
			subject: commonOrFullName(cert.subject),
			issuer: commonOrFullName(cert.issuer),
			date: cert.notBefore,
			id: i,
			mode: DN_SUBJECT
		};
	}

	for (let i = 0; i < certs.length;) {
		let oldName = getDisplayName(info[i]);
		let collision = DN_NONE;
		for (let j = 0; j < certs.length; j++) {
			if (i == j)
				continue;
			if (oldName == getDisplayName(info[j]))
				collision = Math.max(collision, info[i].mode,
					info[j].mode);
		}
		if (collision == DN_NONE) {
			i++;
			continue;
		}
		if (collision < DN_SUBJECT_ISSUER_TIME_COUNTER)
			collision++;
		for (let j = 0; j < certs.length; j++) {
			if (oldName == getDisplayName(info[j]))
				info[j].mode = collision;
		}
		i = 0;
	}

	for (let i = 0; i < certs.length; i++)
		certs[i].displayName = getDisplayName(info[i]);
}

function openCertChooser(slot) {
	chooserSlots[slot].selected = false;

	let creating = browser.windows.create({
		type: "detached_panel",
		url: "pages/certChooser.html"
	}).then(
		function(windowInfo) {
			chooserSlots[slot].id = windowInfo.tabs[0].id;
		}
	);
}

function selectCert(certs, text, hostname, data, options, port, sendResponse) {
	let info = {
		certs: certs,
		text: text,
		hostname: hostname
	};

	let slot = newChooserSlot();
	chooserSlots[slot].data = data;
	chooserSlots[slot].info = info;
	chooserSlots[slot].options = options;
	chooserSlots[slot].port = port;
	chooserSlots[slot].sendResponse = sendResponse;

	openCertChooser(slot);
}

function setHashAlgo(message, options) {
	if (hasOption(options, "sha-256"))
		message.hash = "sha-256";
}

function signTextCall(request, sender, sendResponse) {
	if (request.event != "signText")
		return false;

	let port = browser.runtime.connectNative("signtextjs_plus");

	port.onDisconnect.addListener((p) => {
		log("Native back end disconnected");
		sendResponse({result: ERROR_INTERNAL});
	});

	port.postMessage({
		command: "initialize",
		debug: WEOptions_debug
	});

	let autoSign = false;
	if (hasOption(request.detail.options, "auto")) {
		let allowedSchemes = ["file"];
		for (let scheme of allowedSchemes) {
			if (scheme + ":" == request.detail.protocol) {
				autoSign = true;
				break;
			}
		}
	}

	port.onMessage.addListener((response) => {
		if (response.result) {
			let result = response.result;
			if (!autoSign) {
				let slot = slotFromPort(port);
				if (result == ERROR_AUTHENTICATION_FAILED)
					openCertChooser(slot);
				else {
					freeChooserSlot(slot);
					port.disconnect();
					sendResponse({result: result});
				}
			}
			else {
				port.disconnect();
				sendResponse({result: result});
			}
		}
		else if (response.version) {
			let result = response.version;
			if (WebExtensionVersion != result)
				log(
`Received version ${result}, expected ${WebExtensionVersion}`
				);

			let message = {
				command: "get_certificates",
				invalid: WEOptions_invalid
			};

			let CAs = request.detail.CAs;
			if (CAs.length)
				message.CAs = CAs;

			if (hasOption(request.detail.options,
				"non-repudiation"))
				message.non_repudiation = true;

			port.postMessage(message);
		}
		else if (response.certificates) {
			let certs = response.certificates;
			noZeroMicroseconds(certs);
			fillDisplayNames(certs);

			if (autoSign) {
				log(`Using '${certs[0].displayName}'`);

				let message = {
					command: "sign_data",
					certificate: certs[0].der,
					data: request.detail.data
				};
				setHashAlgo(message, request.detail.options);

				port.postMessage(message);
			}
			else
				selectCert(certs, request.detail.text,
					request.detail.hostname,
					request.detail.data,
					request.detail.options, port,
					sendResponse);
		}
	});
	return true;
}

function getCertChooserInfo(request, sender, sendResponse) {
	if (request.event != "getCertChooserInfo")
		return false;

	let slot = slotFromId(sender.tab.id);
	sendResponse(chooserSlots[slot].info);
	return false;
}

function certChooserResult(request, sender, sendResponse) {
	if (request.event != "certChooserResult")
		return false;

	let slot = slotFromId(sender.tab.id);
	chooserSlots[slot].info.certificate = request.detail.certificate;
	chooserSlots[slot].password = request.detail.password;
	chooserSlots[slot].selected = true;
	return false;
}

function tabRemoved(tabId, removeInfo) {
	let slot = slotFromId(tabId);
	if (slot === -1)
		return;

	let port = chooserSlots[slot].port;
	if (chooserSlots[slot].selected) {
		let cert = chooserSlots[slot].info.certificate;
		log(`Using '${cert.displayName}'`);

		let message = {
			command: "sign_data",
			certificate: cert.der,
			data: chooserSlots[slot].data,
			password: chooserSlots[slot].password
		};
		setHashAlgo(message, chooserSlots[slot].options);

		port.postMessage(message);
	}
	else {
		port.disconnect();
		chooserSlots[slot].sendResponse({result: ERROR_USER_CANCEL});
		freeChooserSlot(slot);
	}
}

browser.runtime.onMessage.addListener(signTextCall);
browser.runtime.onMessage.addListener(getCertChooserInfo);
browser.runtime.onMessage.addListener(certChooserResult);
browser.tabs.onRemoved.addListener(tabRemoved);
