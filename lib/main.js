/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let base64 = require("sdk/base64");
let data = require("sdk/self").data;
let events = require("sdk/system/events");
let prefs = require("sdk/simple-prefs").prefs;
let runtime = require("sdk/system/runtime");
let utils = require("sdk/window/utils");
let system = require("sdk/system");
let _ = require("sdk/l10n").get;

let { Cc, Ci, Cu } = require("chrome");

let { ctypes } = Cu.import("resource://gre/modules/ctypes.jsm", {});
let { console } = Cu.import("resource://gre/modules/devtools/Console.jsm", {});
let { NetUtil } = Cu.import("resource://gre/modules/NetUtil.jsm", {});

let gPrefix = "SignText: ";
function log(x) {
  if (prefs.debug) {
    console.log(gPrefix + x);
  }
}

const ERROR_NO_MATCHING_CERT = "error:noMatchingCert";
const ERROR_USER_CANCEL = "error:userCancel";
const ERROR_INTERNAL = "error:internalError";

const CERTCertDBHandle = ctypes.voidptr_t;
const SECCertUsage = ctypes.int;
const certUsageEmailSigner = 4;
const KU_NON_REPUDIATION = (0x40);
const SECItemType = ctypes.int;
const siBuffer = 0;
const SECItem = ctypes.StructType("SECItem", [
  { "type": SECItemType },
  { "data": ctypes.uint8_t.ptr },
  { "len": ctypes.int }
]);
const SECAlgorithmID = ctypes.StructType("SECAlgorithmID", [
  { "algorithm": SECItem },
  { "parameters": SECItem }
]);
const CERTSignedData = ctypes.StructType("CERTSignedData", [
  { "data": SECItem },
  { "signatureAlgorithm": SECAlgorithmID },
  { "signature": SECItem }
]);
const CERTName = ctypes.StructType("CERTName", [
  { "arena": ctypes.voidptr_t },
  { "rdns": ctypes.voidptr_t }
]);
const CERTValidity = ctypes.StructType("CERTValidity", [
  { "arena": ctypes.voidptr_t },
  { "notBefore": SECItem },
  { "notAfter": SECItem }
]);
const CERTSubjectPublicKeyInfo = ctypes.StructType("CERTSubjectPublicKeyInfo", [
  { "arena": ctypes.voidptr_t },
  { "algorithm": SECAlgorithmID },
  { "subjectPublicKey": SECItem }
]);
const CERTCertificate = ctypes.StructType("CERTCertificate", [
  { "arena": ctypes.voidptr_t },
  { "subjectName": ctypes.char.ptr },
  { "issuerName": ctypes.char.ptr },
  { "signatureWrap": CERTSignedData },
  { "derCert": SECItem },
  { "derIssuer": SECItem },
  { "derSubject": SECItem },
  { "derPublicKey": SECItem },
  { "certKey": SECItem },
  { "version": SECItem },
  { "serialNumber": SECItem },
  { "signature": SECAlgorithmID },
  { "issuer": CERTName },
  { "validity": CERTValidity },
  { "subject": CERTName },
  { "subjectPublicKeyInfo": CERTSubjectPublicKeyInfo },
  { "issuerID": SECItem },
  { "subjectID": SECItem },
  { "extensions": ctypes.voidptr_t },
  { "emailAddr": ctypes.char.ptr },
  { "dbhandle": ctypes.voidptr_t },
  { "subjectKeyID": SECItem },
  { "keyIDGenerated": ctypes.bool },
  { "keyUsage": ctypes.unsigned_int }
]);
const SEC_ERROR_BASE = (-0x2000);
const SEC_ERROR_BAD_PASSWORD = SEC_ERROR_BASE + 15;
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
let CERT_FindCertByDERCert = null;
let CERT_DestroyCertificate = null;
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
  CERT_FindCertByDERCert = declareFunction("CERT_FindCertByDERCert", nss3,
                                           [CERTCertificate.ptr,
                                            CERTCertDBHandle,
                                            SECItem.ptr]);
  CERT_DestroyCertificate = declareFunction("CERT_DestroyCertificate", nss3,
                                            [ctypes.void_t,
                                             CERTCertificate.ptr]);
  SEC_PKCS7CreateSignedData = declareFunction("SEC_PKCS7CreateSignedData",
                                              smime3,
                                              [SEC_PKCS7ContentInfo,
                                               CERTCertificate.ptr,
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
                                             CERTCertificate.ptr,
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

function getUserCerts(signTextArguments) {
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
        if (signTextArguments.length > 3) {
          let found = false;
          searchLoop:
          for (let chainCert = cert; chainCert; chainCert = chainCert.issuer) {
            for (let i = 3; i < signTextArguments.length; i++) {
              if (signTextArguments[i] == chainCert.issuerName) {
                found = true;
                break searchLoop;
              }
            }
          }
          if (!found) {
            continue;
          }
        }
        userCerts.push(cert);
      }
    }
  }

  return userCerts;
}

function cleanupSignTextResources(cert, contentInfo, slotList) {
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
}

function getNativeCert(certDB, cert) {
  let aLength = {};
  let data = cert.getRawDER(aLength);
  let byteArray = ctypes.ArrayType(ctypes.uint8_t);
  let derBuffer = new byteArray(data.length);
  for (let i = 0; i < data.length; i++) {
    derBuffer[i] = data[i];
  }
  let derCert = new SECItem;
  derCert.type = siBuffer;
  derCert.data = derBuffer;
  derCert.len = data.length;
  return CERT_FindCertByDERCert(certDB, derCert.address());
}

function getCertNickname(cert) {
  if (cert.displayName) {
    // Since Firefox 53
    // TODO: Untested
    return cert.displayName;
  }
  return cert.nickname;
}

function selectCert(userCerts, text) {
  let certArray = [];
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
  sandbox.l10n["key_usage"] = _("key_usage");
  sandbox.l10n["email"] = _("email");
  sandbox.l10n["issuer"] = _("issuer");
  sandbox.l10n["token"] = _("token");
  for (let cert of userCerts) {
    let sandboxCert = new sandbox.Cert();
    sandboxCert.nickname = getCertNickname(cert);
    sandboxCert.subject = cert.subjectName;
    sandboxCert.serialNumber = cert.serialNumber;
    sandboxCert.notBefore = cert.validity.notBeforeLocalTime;
    sandboxCert.notAfter = cert.validity.notAfterLocalTime;
    if (cert.keyUsages) {
      // Tested on Firefox 51
      sandboxCert.usagesString = cert.keyUsages;
    } else {
      let usages = {};
      // Dropped from Firefox 50
      if (cert.getUsagesString) {
        // true for local-only verification
        cert.getUsagesString(true, {}, usages);
      }
      sandboxCert.usagesString = usages.value;
    }
    sandboxCert.email = cert.emailAddress;
    sandboxCert.issuer = cert.issuerName;
    sandboxCert.token = cert.tokenName;
    sandbox.certs[cert.dbKey] = sandboxCert;
    certArray[cert.dbKey] = cert;
  }
  let watcher = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                  .getService(Ci.nsIWindowWatcher);
  let dialog = domWindow.openDialog(data.url("certChooser.html"),
                                    "_blank",
                                    "dialog,centerscreen,chrome,modal",
                                    sandbox);
  let result = {
    error: null,
    cert: certArray[sandbox.selectedCert],
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

function logPRError() {
  try {
    let error = PR_GetError();
    let errorString = ctypeStringToJSString(PR_ErrorToString(error, null));
    log("NSS error: " + errorString + " (" + error + ")");
  } catch (error) {
    log("logging an NSS error failed");
  }
}

function signText(domWindow, text, caOption) {
  let userCerts = getUserCerts(arguments);
  let nonRepudiation = caOption == "auto non-repudiation" ||
                       caOption == "ask non-repudiation";
  if (nonRepudiation) {
    let certDB = CERT_GetDefaultCertDB();
    if (certDB.isNull()) {
      log("CERT_GetDefaultCertDB failed");
      logPRError();
      return ERROR_INTERNAL;
    }
    let filteredCerts = [];
    for (let cert of userCerts) {
      let nativeCert = getNativeCert(certDB, cert);
      if (nativeCert.isNull()) {
        log("getNativeCert failed");
        logPRError();
        return ERROR_INTERNAL;
      }
      if (nativeCert.contents.keyUsage & KU_NON_REPUDIATION) {
        filteredCerts.push(cert);
      }
      cleanupSignTextResources(nativeCert, null, null);
    }
    userCerts = filteredCerts;
  }
  if (userCerts.length < 1) {
    return ERROR_NO_MATCHING_CERT;
  }

  let autoSign = false;
  if (caOption == "auto" || caOption == "auto non-repudiation") {
    let uri = NetUtil.newURI(domWindow.content.location);
    let allowedSchemes = ["chrome", "file", "resource"];
    for (let scheme of allowedSchemes) {
      if (uri.schemeIs(scheme)) {
        autoSign = true;
        break;
      }
    }
  }

  // These are the resources that, if non-null, must be cleaned-up on all code
  // paths in this function.
  let cert = null;
  let contentInfo = null;
  let slotList = null;

  try {
    let certDB = CERT_GetDefaultCertDB();
    if (certDB.isNull()) {
      log("CERT_GetDefaultCertDB failed");
      logPRError();
      return ERROR_INTERNAL;
    }
    for (;;) {
      let selectedCert = null;
      if (autoSign) {
        selectedCert = {
          error: null,
          cert: userCerts[0],
          password: null
        };
      } else {
        selectedCert = selectCert(userCerts, text);
        if (selectedCert.error != null) {
          return selectedCert.error;
        }
      }

      log("using '" + getCertNickname(selectedCert.cert) + "'");
      cert = getNativeCert(certDB, selectedCert.cert);
      if (cert.isNull()) {
        log("getNativeCert failed");
        logPRError();
        return ERROR_INTERNAL;
      }

      slotList = PK11_GetAllSlotsForCert(cert, null);
      if (slotList.isNull()) {
        log("PK11_GetAllSlotsForCert failed");
        cleanupSignTextResources(cert, null, slotList);
        return ERROR_INTERNAL;
      }
      if (!autoSign) {
        let status = SECSuccess;
        let cLogin = 0;
        let cBadPwd = 0;
        for (let it = slotList.contents.head; it && !it.isNull();
             it = it.contents.next) {
          if (PK11_NeedLogin(it.contents.slot)) {
            cLogin++;
            let rv = PK11_CheckUserPassword(it.contents.slot,
                                            selectedCert.password);
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
        }
        if (status != SECSuccess || (cLogin > 0 && cLogin == cBadPwd)) {
          log("Authentication for '" + getCertNickname(selectedCert.cert) +
              "' failed");
          cleanupSignTextResources(cert, null, slotList);
          cert = null;
          slotList = null;
          continue;
        }
      }
      break;
    }

    let digestBytes = hash(text, domWindow.document.characterSet);
    let byteArray = ctypes.ArrayType(ctypes.uint8_t);
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
      cleanupSignTextResources(cert, contentInfo, slotList);
      return ERROR_INTERNAL;
    }

    let status = SEC_PKCS7IncludeCertChain(contentInfo, null);
    if (status != SECSuccess) {
      log("SEC_PKCS7IncludeCertChain failed");
      logPRError();
      cleanupSignTextResources(cert, contentInfo, slotList);
      return ERROR_INTERNAL;
    }

    status = SEC_PKCS7AddSigningTime(contentInfo);
    if (status != SECSuccess) {
      log("SEC_PKCS7AddSigningTime failed");
      logPRError();
      cleanupSignTextResources(cert, contentInfo, slotList);
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
      cleanupSignTextResources(cert, contentInfo, slotList);
      return ERROR_INTERNAL;
    }
    cleanupSignTextResources(cert, contentInfo, slotList);
    let result = base64.encode(output).replace(/.{64}/g, "$&\n");
    return result;
  } catch (error) {
    log("signText failed: " + error);
    cleanupSignTextResources(cert, contentInfo, slotList);
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

    let domWindow = utils.getMostRecentBrowserWindow();
    let event = {
      data: null,
      subject: domWindow.content
    };
    injectSignText(event);
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
