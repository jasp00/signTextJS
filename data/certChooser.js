// data is an object with the following properties:
//   domain: a string representing the domain that called signText
//   textToSign: the text being signed
//   certs: a map of dbKeys to objects with the following properties:
//     displayName: the displayName of a certificate
//     subject: the subject of a certificate
//     issuer: the issuer of a certificate
//     token: the token the certificate lives on
//   cancelled: to be set to true if the user cancels the dialog
//   selectedCert: the dbKey of the selected certificate
var data = window.arguments[0];
var textArea = document.getElementById("text");
textArea.textContent = data.textToSign;
var certDisplayNames = document.getElementById("certDisplayNames");
for (var key in data.certs) {
  var option = document.createElement("option");
  option.setAttribute("value", key);
  option.textContent = data.certs[key].displayName;
  certDisplayNames.appendChild(option);
}

// If the user closes the window without clicking "OK" or "Cancel",
// assume they wanted to cancel.
data.cancelled = true;

function displayCertDetails() {
  var selection = document.getElementById("certDisplayNames");
  data.selectedCert = selection.value;
  var certDetails = data.certs[selection.value];
  var detailsElement = document.getElementById("certDetails");
  detailsElement.textContent = data.l10n["subject"] + " " + certDetails.subject + "\n" +
                               "  " + data.l10n["serial"] + " " + certDetails.serialNumber + "\n" +
                               "  " + data.l10n["valid_from"] + " " +
                                      certDetails.notBefore + " " + data.l10n["to"] + " " +
                                      certDetails.notAfter + "\n" +
                               "  " + data.l10n["key_usage"] + " " + certDetails.usagesString + "\n" +
                               "  " + data.l10n["email"] + " " + certDetails.email + "\n" +
                               data.l10n["issuer"] + " " + certDetails.issuer + "\n" +
                               data.l10n["token"] + " " + certDetails.token;
  document.getElementById("certPassword").focus();
}

displayCertDetails();

function doOK() {
  data.cancelled = false;
  data.certPassword = document.getElementById("certPassword").value;
  window.close();
}

function doCancel() {
  window.close();
}

function keyboardListener(e) {
  // KeyCode 13 is Enter, and keyCode 27 is Escape key.
  if (e.keyCode === 13) {
    doOK();
  } else if (e.keyCode === 27) {
    doCancel();
  }
}

document.addEventListener("keydown", keyboardListener);
document.addEventListener("focus", function(event) {
  document.getElementById("certPassword").focus();
  event.target.removeEventListener(event.type, arguments.callee);
  var headline = document.getElementById("headline");
  headline.textContent = headline.textContent.replace("<site here>", data.domain);
});
