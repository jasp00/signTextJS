/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let base64 = require("sdk/base64");
let data = require("sdk/self").data;
let events = require("sdk/system/events");
let runtime = require("sdk/system/runtime");
let utils = require("sdk/window/utils");
let system = require("sdk/system");
let _ = require("sdk/l10n").get;

let { Cc, Ci, Cu } = require("chrome");

let { XPCOMUtils } = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});
let { ctypes } = Cu.import("resource://gre/modules/ctypes.jsm", {});
let { console } = Cu.import("resource://gre/modules/devtools/Console.jsm", {});

Cu.importGlobalProperties(["atob"]);

let gDebug = true;
let gPrefix = "SignText: ";
function log(x) {
  if (gDebug) {
    console.log(gPrefix + x);
  }
}

const ERROR_NO_MATCHING_CERT = "error:noMatchingCert";
const ERROR_USER_CANCEL = "error:userCancel";
const ERROR_INTERNAL = "error:internalError";
const ERROR_AUTHENTICATION_FAILED = "error:authenticationFailed";

const CERTCertDBHandle = ctypes.voidptr_t;
const CERTCertificate = ctypes.voidptr_t;
const SECCertUsage = ctypes.int;
const certUsageEmailSigner = 4;
const SECItemType = ctypes.int;
const siBuffer = 0;
const SECItem = ctypes.StructType("SECItem", [
  { "type": SECItemType },
  { "data": ctypes.uint8_t.ptr },
  { "len": ctypes.int }
]);
const CERTName = ctypes.StructType("CERTName", [
  { "arena": ctypes.voidptr_t },
  { "rdns": ctypes.voidptr_t }
]);
const CERTIssuerAndSN = ctypes.StructType("CERTIssuerAndSN", [
  { "derIssuer": SECItem },
  { "issuer": CERTName },
  { "serialNumber": SECItem }
]);
const SEC_PKCS7ContentInfo = ctypes.voidptr_t;
const SECOidTag = ctypes.int;
const SEC_OID_SHA1 = 4;
const SECStatus = ctypes.int;
const SECSuccess = 0;
const SEC_PKCS7EncoderOutputCallback = ctypes.FunctionType(ctypes.default_abi,
                                                           ctypes.void_t,
                                                           [ctypes.voidptr_t,
                                                            ctypes.char.ptr,
                                                            ctypes.int]);
const PK11SlotInfo = ctypes.voidptr_t;
let PK11SlotListElement = ctypes.StructType("PK11SlotListElement");
PK11SlotListElement.define([
  {"next": PK11SlotListElement.ptr},
  {"prev": PK11SlotListElement.ptr},
  {"slot": PK11SlotInfo},
  {"refCount": ctypes.int}
]);
const PK11SlotList = ctypes.StructType("PK11SlotList", [
  {"head": PK11SlotListElement.ptr},
  {"tail": PK11SlotListElement.ptr},
  {"lock": ctypes.voidptr_t}
]);

let nss3 = null;
let smime3 = null;
let nspr4 = null;
let CERT_GetDefaultCertDB = null;
let CERT_FindCertByIssuerAndSN = null;
let CERT_DestroyCertificate = null;
let SECITEM_FreeItem = null;
let SEC_PKCS7CreateSignedData = null;
let SEC_PKCS7IncludeCertChain = null;
let SEC_PKCS7AddSigningTime = null;
let SEC_PKCS7Encode = null;
let SEC_PKCS7DestroyContentInfo = null;
let PR_GetError = null;
let PR_ErrorToString = null;
let PK11_GetAllSlotsForCert = null;
let PK11_FreeSlotList = null;
let PK11_NeedLogin = null;
let PK11_CheckUserPassword = null;

function platformIsOSX() {
  return runtime.OS == "Darwin";
}

function librariesAreFolded() {
  return runtime.OS == "WINNT" || platformIsOSX();
}

function declareFunction(name, library, args) {
  try {
    args.unshift(ctypes.default_abi);
    args.unshift(name);
    return library.declare.apply(library, args);
  } catch (error) {
    log("couldn't find function '" + name + "' to declare");
    throw error;
  }
}

function loadLibraries() {
  let dir = "";
  if (platformIsOSX()) {
    dir = system.pathFor("GreBinD") + "/";
  }
  let nss3path = ctypes.libraryName("nss3");
  try {
    nss3 = ctypes.open(dir + nss3path);
  } catch (error) {
    log("opening nss3 failed: " + error);
    throw error;
  }

  if (!librariesAreFolded()) {
    let smime3path = ctypes.libraryName("smime3");
    try {
      smime3 = ctypes.open(smime3path);
    } catch (error) {
      log("opening smime3 failed: " + error);
      throw error;
    }

    let nspr4path = ctypes.libraryName("nspr4");
    try {
      nspr4 = ctypes.open(nspr4path);
    } catch (error) {
      log("opening nspr4 failed: " + error);
      throw error;
    }
  } else {
    // On Windows and OS X, these libraries aren't separate.
    smime3 = nss3;
    nspr4 = nss3;
  }


  CERT_GetDefaultCertDB = declareFunction("CERT_GetDefaultCertDB", nss3,
                                          [CERTCertDBHandle]);
  CERT_FindCertByIssuerAndSN = declareFunction("CERT_FindCertByIssuerAndSN", nss3,
                                             [CERTCertificate,
                                              CERTCertDBHandle,
                                              CERTIssuerAndSN.ptr]);
  CERT_DestroyCertificate = declareFunction("CERT_DestroyCertificate", nss3,
                                            [ctypes.void_t,
                                             CERTCertificate]);
  SECITEM_FreeItem = declareFunction("SECITEM_FreeItem", nss3,
                                     [ctypes.void_t,
                                      SECItem.ptr,
                                      ctypes.bool]);
  SEC_PKCS7CreateSignedData = declareFunction("SEC_PKCS7CreateSignedData",
                                              smime3,
                                              [SEC_PKCS7ContentInfo,
                                               CERTCertificate,
                                               SECCertUsage,
                                               CERTCertDBHandle,
                                               SECOidTag,
                                               SECItem.ptr,
                                               ctypes.voidptr_t,
                                               ctypes.voidptr_t]);
  SEC_PKCS7IncludeCertChain = declareFunction("SEC_PKCS7IncludeCertChain",
                                              smime3,
                                              [SECStatus,
                                               SEC_PKCS7ContentInfo,
                                               ctypes.voidptr_t]);
  SEC_PKCS7AddSigningTime = declareFunction("SEC_PKCS7AddSigningTime", smime3,
                                            [SECStatus,
                                             SEC_PKCS7ContentInfo]);
  SEC_PKCS7Encode = declareFunction("SEC_PKCS7Encode", smime3,
                                    [SECStatus,
                                     SEC_PKCS7ContentInfo,
                                     SEC_PKCS7EncoderOutputCallback.ptr,
                                     ctypes.voidptr_t,
                                     ctypes.voidptr_t,
                                     ctypes.voidptr_t,
                                     ctypes.voidptr_t]);
  SEC_PKCS7DestroyContentInfo = declareFunction("SEC_PKCS7DestroyContentInfo",
                                                smime3,
                                                [ctypes.void_t,
                                                 SEC_PKCS7ContentInfo]);
  PR_GetError = declareFunction("PR_GetError", nspr4, [ctypes.int]);
  PR_ErrorToString = declareFunction("PR_ErrorToString", nspr4,
                                     [ctypes.char.ptr,
                                      ctypes.int,
                                      ctypes.voidptr_t]);
  PK11_GetAllSlotsForCert = declareFunction("PK11_GetAllSlotsForCert", nss3,
                                            [PK11SlotList.ptr,
                                             CERTCertificate,
                                             ctypes.voidptr_t]);
  PK11_FreeSlotList = declareFunction("PK11_FreeSlotList", nss3,
                                      [ctypes.void_t,
                                       PK11SlotList.ptr]);
  PK11_NeedLogin = declareFunction("PK11_NeedLogin", nss3,
                                   [ctypes.int,
                                    PK11SlotInfo]);
  PK11_CheckUserPassword = declareFunction("PK11_CheckUserPassword", nss3,
                                           [SECStatus,
                                            PK11SlotInfo,
                                            ctypes.char.ptr]);
}

function unloadLibraries() {
  if (nss3) {
    nss3.close();
  }
  if (smime3 && !librariesAreFolded()) {
    smime3.close();
  }
  if (nspr4 && !librariesAreFolded()) {
    nspr4.close();
  }
}

function getUserCerts() {
  let certDB = Cc["@mozilla.org/security/x509certdb;1"]
                 .getService(Ci.nsIX509CertDB);
  let certList = certDB.getCerts();
  let userCerts = [];
  let certListEnumerator = certList.getEnumerator();
  let now = Date.now();
  while (certListEnumerator.hasMoreElements()) {
    let cert = certListEnumerator.getNext().QueryInterface(Ci.nsIX509Cert);
    if (cert.certType & Ci.nsIX509Cert.USER_CERT) {
      // notAfter and notBefore are microseconds since the epoch,
      // whereas Date.now() is in milliseconds
      if (now >= cert.validity.notBefore / 1000 &&
          now <= cert.validity.notAfter / 1000) {
        userCerts.push(cert);
      }
    }
  }

  return userCerts;
}

function cleanupSignTextResources(cert, contentInfo, encodedItem, slotList) {
  try {
    if (cert && !cert.isNull()) {
      CERT_DestroyCertificate(cert);
    }
  } catch (error) {
    log("CERT_DestroyCertificate failed");
    logPRError();
  }

  try {
    if (slotList && !slotList.isNull()) {
      PK11_FreeSlotList(slotList);
    }
  } catch (error) {
    log("PK11_FreeSlotList failed");
    logPRError();
  }

  try {
    if (contentInfo && !contentInfo.isNull()) {
      SEC_PKCS7DestroyContentInfo(contentInfo);
    }
  } catch (error) {
    log("SEC_PKCS7DestroyContentInfo failed");
    logPRError();
  }

  try {
    if (encodedItem && !encodedItem.isNull()) {
      SECITEM_FreeItem(encodedItem, true);
    }
  } catch (error) {
    log("SECITEM_FreeItem failed");
    logPRError();
  }
}

function selectCert(userCerts, text) {
  // We have to create a sandbox with the same origin as this addon's content
  // resources so we can pass data into (and get it back out of) the dialog we
  // open up to let the user select a signing certificate and confirm the
  // signing.
  let sandboxDeclarations = "var domain;\n";
  sandboxDeclarations += "var textToSign;\n";
  sandboxDeclarations += "var certs = {};\n";
  sandboxDeclarations += "var cancelled;\n";
  sandboxDeclarations += "var selectedCert;\n";
  sandboxDeclarations += "var certPassword;\n";
  sandboxDeclarations += "function Cert() {};\n";
  sandboxDeclarations += "var l10n = {}\n";
  let sandbox = Cu.Sandbox(data.url("certChooser.html"));
  Cu.evalInSandbox(sandboxDeclarations, sandbox);
  let domWindow = utils.getMostRecentBrowserWindow();
  sandbox.domain = domWindow.content.location.hostname;
  sandbox.textToSign = text;
  // l10n
  sandbox.l10n["subject"] = _("subject");
  sandbox.l10n["serial"] = _("serial");
  sandbox.l10n["valid_from"] = _("valid_from");
  sandbox.l10n["to"] = _("to");
  sandbox.l10n["email"] = _("email");
  sandbox.l10n["issuer"] = _("issuer");
  sandbox.l10n["token"] = _("token");
  for (let cert of userCerts) {
    sandbox.certs[cert.dbKey] = new sandbox.Cert();
    sandbox.certs[cert.dbKey].displayName = cert.displayName || cert.nickname;
    sandbox.certs[cert.dbKey].subject = cert.subjectName;
    sandbox.certs[cert.dbKey].serialNumber = cert.serialNumber;
    sandbox.certs[cert.dbKey].notBefore = cert.validity.notBeforeLocalTime;
    sandbox.certs[cert.dbKey].notAfter = cert.validity.notAfterLocalTime;
    sandbox.certs[cert.dbKey].email = cert.emailAddress;
    sandbox.certs[cert.dbKey].issuer = cert.issuerName;
    sandbox.certs[cert.dbKey].token = cert.tokenName;
  }
  let watcher = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                  .getService(Ci.nsIWindowWatcher);
  let dialog = domWindow.openDialog(data.url("certChooser.html"),
                                    "_blank",
                                    "dialog,centerscreen,chrome,modal",
                                    sandbox);
  let result = {
    error: null,
    dbKey: sandbox.selectedCertDBKey,
    displayName: sandbox.certs[sandbox.selectedCertDBKey].displayName,
    password: sandbox.certPassword
  };
  if (sandbox.cancelled) {
    result.error = ERROR_USER_CANCEL;
  }
  return result;
}

// charPtr is expected to be null-terminated
function ctypeStringToJSString(charPtr) {
  let jsString = "";
  while (charPtr.contents != 0) {
    jsString += String.fromCharCode(charPtr.contents);
    charPtr = charPtr.increment();
  }
  return jsString;
}

function ctypeBufferToJSString(charPtr, length) {
  let jsString = "";
  for (let i = 0; i < length; i++) {
    jsString += String.fromCharCode(charPtr.contents);
    charPtr = charPtr.increment();
  }
  return jsString;
}

function bytesToUint32(bytes) {
  return (bytes[0] << 24) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
}

function logPRError() {
  try {
    let error = PR_GetError();
    let errorString = ctypeStringToJSString(PR_ErrorToString(error, null));
    log("NSS error: " + errorString + " (" + error + ")");
  } catch (error) {
    log("logging an NSS error failed");
  }
}

function signText(domWindow, text) {
  let userCerts = getUserCerts();
  if (userCerts.length < 1) {
    return ERROR_NO_MATCHING_CERT;
  }

  let selectedCert = selectCert(userCerts, text);
  if (selectedCert.error != null) {
    return selectedCert.error;
  }

  // These are the resources that, if non-null, must be cleaned-up on all code
  // paths in this function.
  let cert = null;
  let contentInfo = null;
  let encodedItem = null;
  let slotList = null;

  try {
    let certDB = CERT_GetDefaultCertDB();
    if (certDB.isNull()) {
      log("CERT_GetDefaultCertDB failed");
      logPRError();
      return ERROR_INTERNAL;
    }
    log("using '" + selectedCert.displayName + "'");
    // The format of dbKey is 8 bytes of 0, 4 bytes for the length of the serial
    // number, 4 bytes for the length of the issuer, the bytes of the serial
    // number, and then the bytes of the issuer.
    let dbKey = atob(selectedCert.dbKey.replace(/[\r\n]/g, ""));
    let serialNumberLenBytes = [ dbKey.charCodeAt(8), dbKey.charCodeAt(9),
                                 dbKey.charCodeAt(10), dbKey.charCodeAt(11) ];
    let serialNumberLen = bytesToUint32(serialNumberLenBytes);
    let issuerLenBytes = [ dbKey.charCodeAt(12), dbKey.charCodeAt(13),
                           dbKey.charCodeAt(14), dbKey.charCodeAt(15) ];
    let issuerLen = bytesToUint32(issuerLenBytes);
    let byteArray = ctypes.ArrayType(ctypes.uint8_t);
    let serialNumberByteArray = new byteArray(serialNumberLen);
    for (let i = 0; i < serialNumberLen; i++) {
      serialNumberByteArray[i] = dbKey.charCodeAt(8 + 4 + 4 + i);
    }
    let issuerByteArray = new byteArray(issuerLen);
    for (let i = 0; i < issuerLen; i++) {
      issuerByteArray[i] = dbKey.charCodeAt(8 + 4 + 4 + serialNumberLen + i);
    }
    let serialNumber = new SECItem;
    serialNumber.type = siBuffer;
    serialNumber.data = serialNumberByteArray;
    serialNumber.len = serialNumberLen;
    let derIssuer = new SECItem;
    derIssuer.type = siBuffer;
    derIssuer.data = issuerByteArray;
    derIssuer.len = issuerLen;
    let issuerAndSN = new CERTIssuerAndSN;
    issuerAndSN.derIssuer = derIssuer;
    issuerAndSN.serialNumber = serialNumber;
    cert = CERT_FindCertByIssuerAndSN(certDB, issuerAndSN.address());
    if (cert.isNull()) {
      log("CERT_FindCertByIssuerAndSN failed");
      logPRError();
      return ERROR_INTERNAL;
    }

    slotList = PK11_GetAllSlotsForCert(cert, null);
    if (slotList.isNull()) {
      log("PK11_GetAllSlotsForCert failed");
      cleanupSignTextResources(cert, contentInfo, encodedItem, slotList);
      return ERROR_INTERNAL;
    }
    let status = SECSuccess;
    let it = slotList.contents.head;
    let cLogin = 0;
    let cBadPwd = 0;
    while (it && !it.isNull()) {
      if (PK11_NeedLogin(it.contents.slot)) {
        cLogin++;
        let rv = PK11_CheckUserPassword(it.contents.slot, selectedCert.password);
        if (rv != SECSuccess) {
          log("PK11_CheckUserPassword failed");
          if (PR_GetError() != SEC_ERROR_BAD_PASSWORD) {
            status = rv;
            break;
          } else {
            cBadPwd++;
          }
        }
      }
      it = it.contents.next;
    }
    if (status != SECSuccess || (cLogin > 0 && cLogin == cBadPwd)) {
      log("Authentication for '" + selectedCert.displayName + "' failed");
      cleanupSignTextResources(cert, contentInfo, encodedItem, slotList);
      return ERROR_AUTHENTICATION_FAILED;
    }

    let digestBytes = hash(text, domWindow.document.characterSet);
    let digestBytesBuffer = new byteArray(digestBytes.length);
    for (let i = 0; i < digestBytes.length; i++) {
      digestBytesBuffer[i] = digestBytes.charCodeAt(i);
    }
    let digest = new SECItem;
    digest.type = siBuffer;
    digest.data = digestBytesBuffer;
    digest.len = digestBytes.length;
    contentInfo = SEC_PKCS7CreateSignedData(cert, certUsageEmailSigner, certDB,
                                            SEC_OID_SHA1, digest.address(),
                                            null, null);
    if (contentInfo.isNull()) {
      log("SEC_PKCS7CreateSignedData failed");
      logPRError();
      cleanupSignTextResources(cert, contentInfo, encodedItem, slotList);
      return ERROR_INTERNAL;
    }

    status = SEC_PKCS7IncludeCertChain(contentInfo, null);
    if (status != SECSuccess) {
      log("SEC_PKCS7IncludeCertChain failed");
      logPRError();
      cleanupSignTextResources(cert, contentInfo, encodedItem, slotList);
      return ERROR_INTERNAL;
    }

    status = SEC_PKCS7AddSigningTime(contentInfo);
    if (status != SECSuccess) {
      log("SEC_PKCS7AddSigningTime failed");
      logPRError();
      cleanupSignTextResources(cert, contentInfo, encodedItem, slotList);
      return ERROR_INTERNAL;
    }

    let output = "";
    let encoderOutputCallback = new SEC_PKCS7EncoderOutputCallback.ptr(
      function(context, data, length) {
        if (data.isNull()) {
          log("data is null in encoderOutputCallback - library failure?");
          logPRError();
          return;
        }
        output += ctypeBufferToJSString(data, length);
      }
    );
    status = SEC_PKCS7Encode(contentInfo, encoderOutputCallback, null, null,
                             null, null);
    if (status != SECSuccess) {
      log("SEC_PKCS7Encode failed");
      logPRError();
      cleanupSignTextResources(cert, contentInfo, encodedItem, slotList);
      return ERROR_INTERNAL;
    }
    cleanupSignTextResources(cert, contentInfo, encodedItem, slotList);
    let result = base64.encode(output).replace(/.{64}/g, "$&\n");
    return result;
  } catch (error) {
    log("signText failed: " + error);
    cleanupSignTextResources(cert, contentInfo, encodedItem, slotList);
  }

  return ERROR_INTERNAL;
}

// modified from browser/base/content/aboutaccounts/aboutaccounts.js
function hash(string, charset) {
  let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
                    .createInstance(Ci.nsIScriptableUnicodeConverter);
  converter.charset = charset;
  // Data is an array of bytes.
  let data = converter.convertToByteArray(string, {});
  let hasher = Cc["@mozilla.org/security/hash;1"]
                 .createInstance(Ci.nsICryptoHash);
  hasher.init(Ci.nsICryptoHash.SHA1);
  hasher.update(data, data.length);

  return hasher.finish(false);
}

function injectSignText(event) {
  // event.subject is an nsIDOMWindow
  // event.data is a string representing the origin
  log("injecting signText for origin " + event.data);
  let domWindow = event.subject;

  // Add signText() to window.crypto
  // Note: If you want to re-add other legacy functions, just repeat
  // these two lines with "defineAs" set to the API name, and the
  // first argument replaced by your implementation function.
  Cu.exportFunction(signText.bind(this, domWindow),
                    domWindow.crypto.wrappedJSObject,
                    { defineAs: "signText" });
}

let gInitialized = false;

exports.main = function(options, callbacks) {
  if (!gInitialized &&
      (options.loadReason == "startup" ||
       options.loadReason == "install" ||
       options.loadReason == "enable")) {
    log("initializing");
    try {
      loadLibraries();
      events.on("content-document-global-created", injectSignText);
    } catch (error) {
      log("loadLibraries failed: " + error);
    }
    gInitialized = true;
  }
};

exports.onUnload = function(reason) {
  log("onUnload: " + reason);
  if (gInitialized && (reason == "shutdown" || reason == "disable")) {
    log("deinitializing");
    events.off("content-document-global-created", injectSignText);
    unloadLibraries();
    gInitialized = false;
  }
};
