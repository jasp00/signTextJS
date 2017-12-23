// signTextJS plus native logic
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

#include <iostream>
#include <json/json.h>
#include <nspr/nspr.h>
#include <nss/cert.h>
#include <nss/hasht.h>
#include <nss/nss.h>
#include <nss/nssb64.h>
#include <nss/pk11pub.h>
#include <nss/secerr.h>
#include <nss/sechash.h>
#include <nss/secpkcs7.h>

#include "config.h"

union msg_size {
	uint32_t u;
	char c[4];
};

static const char ERROR_NO_MATCHING_CERT[] = "error:noMatchingCert";
static const char ERROR_INTERNAL[] = "error:internalError";
static const char ERROR_AUTHENTICATION_FAILED[] = "error:authenticationFailed";

static bool s_debug = true;

static void log(const std::string &s) {
	if (s_debug)
		std::cerr << s << std::endl;
}

static void log_PR_error(void) {
	if (!s_debug)
		return;
	PRErrorCode code = PR_GetError();
	const char *s = PR_ErrorToString(code, PR_LANGUAGE_I_DEFAULT);
	std::cerr << "NSS error: " << s << " (" << code << ")" << std::endl;
}

static bool initialize(Json::Value &req, Json::Value &res) {
	s_debug = req["debug"].asBool();

	res["version"] = WEB_EXTENSION_VERSION;
	return false;
}

static void error_noMatchingCert(Json::Value &res) {
	res["result"] = ERROR_NO_MATCHING_CERT;
}

static std::string iso_8601(PRTime usecs) {
	PRExplodedTime exploded;
	PR_ExplodeTime(usecs, PR_GMTParameters, &exploded);
	char str[sizeof
"-32768-4294967295-4294967295T4294967295:4294967295:4294967295,4294967295Z"];
	sprintf(str, "%04d-%02u-%02uT%02u:%02u:%02u,%06uZ", exploded.tm_year,
		exploded.tm_month + 1, exploded.tm_mday, exploded.tm_hour,
		exploded.tm_min, exploded.tm_sec, exploded.tm_usec);
	return str;
}

static std::string key_usage_string(unsigned int u) {
	const char *usage[] = {
		"digital signature",
		"non-repudiation",
		"key encipherment",
		"data encipherment",
		"key agreement",
		"certificate signing",
		"CRL signing",
		"encipher only"
	};
	std::string str;
	for (unsigned int i = 0; i < sizeof usage / sizeof usage[0]; i++) {
		if (u & 0x80 >> i) {
			if (str.length())
				str += ',';
			str += usage[i];
		}
	}
	return str;
}

static void remove_crlf(char *s) {
	char *s1 = strchr(s, '\r');
	if (!s1)
		return;
	for (char *s2 = s1; *s2;) {
		if (*s2 == '\r') {
			s2++;
			if (!*s2++)
				break;
			continue;
		}
		*s1++ = *s2++;
	}
	*s1 = '\0';
}

static bool get_user_certs(Json::Value &req, Json::Value &res) {
	CERTCertDBHandle *handle = CERT_GetDefaultCertDB();
	if (!handle)
		return true;

	CERTCertList *cert_list = CERT_FindUserCertsByUsage(handle,
		certUsageEmailSigner, PR_FALSE, PR_TRUE, NULL);
	if (!cert_list) {
		error_noMatchingCert(res);
		return false;
	}

	bool non_repudiation = req.get("non_repudiation", false).asBool();
	if (non_repudiation) {
		CERTCertListNode *node = CERT_LIST_HEAD(cert_list);
		while (!CERT_LIST_END(node, cert_list)) {
			if (node->cert->keyUsage & KU_NON_REPUDIATION)
				node = CERT_LIST_NEXT(node);
			else {
				CERTCertListNode *removed = node;
				node = CERT_LIST_NEXT(removed);
				CERT_RemoveCertListNode(removed);
			}
		}
	}

	bool error = false;

	if (req.isMember("CAs")) {
		Json::Value &CAs = req["CAs"];
		int nCANames = CAs.size();
		char **caNames = new char *[nCANames];
		for (int i = 0; i < nCANames; i++)
			caNames[i] = strdup(CAs[i].asCString());

		if (CERT_FilterCertListByCANames(cert_list, nCANames, caNames,
			certUsageEmailSigner) != SECSuccess)
			error = true;

		for (int i = 0; i < nCANames; i++)
			free(caNames[i]);
		delete[] caNames;
		if (error)
			goto cleanup_list;
	}

	if (CERT_LIST_EMPTY(cert_list))
		error_noMatchingCert(res);
	else {
		int index = 0;
		for (CERTCertListNode *node = CERT_LIST_HEAD(cert_list);
			!CERT_LIST_END(node, cert_list);
			node = CERT_LIST_NEXT(node)) {
			CERTCertificate *cert = node->cert;
			Json::Value &json_cert = res["certificates"][index++];
			json_cert["subject"] = cert->subjectName;

			std::string sn;
			char hex[3];
			unsigned int len = cert->serialNumber.len;
			for (unsigned int i = 0; i < len; i++) {
				sprintf(hex, "%02X",
					cert->serialNumber.data[i]);
				if (i)
					sn += ':';
				sn += hex;
			}
			json_cert["serialNumber"] = sn;

			PRTime notBefore, notAfter;
			if (CERT_GetCertTimes(cert, &notBefore, &notAfter)
				!= SECSuccess) {
				error = true;
				goto cleanup_list;
			}
			json_cert["notBefore"] = iso_8601(notBefore);
			json_cert["notAfter"] = iso_8601(notAfter);

			if (cert->keyUsagePresent)
				json_cert["usage"]
					= key_usage_string(cert->rawKeyUsage);

			json_cert["email"] = cert->emailAddr;
			json_cert["issuer"] = cert->issuerName;

			if (cert->slot)
				json_cert["token"]
					= PK11_GetTokenName(cert->slot);

			char *der_b64 = NSSBase64_EncodeItem(NULL, NULL, 0,
				&cert->derCert);
			if (!der_b64) {
				error = true;
				goto cleanup_list;
			}
			remove_crlf(der_b64);
			json_cert["der"] = der_b64;
			free(der_b64);
		}
	}

cleanup_list:
	CERT_DestroyCertList(cert_list);
	return error;
}

static void outputfn(void *arg, const char *buf, unsigned long len) {
	if (!buf) {
		log("buf is null in outputfn - library failure?");
		log_PR_error();
		return;
        }
	((std::string *)arg)->append(buf, len);
}

static bool sign_text(Json::Value &req, Json::Value &res) {
// hash algo = SHA1;
	std::string cert_b64 = req["certificate"].asString();

	SECItem *derCert = NSSBase64_DecodeBuffer(NULL, NULL, cert_b64.c_str(),
		cert_b64.length());
	if (!derCert) {
		log("Could not decode certificate");
		return true;
	}

	bool error = false;

	CERTCertDBHandle *handle = CERT_GetDefaultCertDB();
	if (!handle) {
		log("CERT_GetDefaultCertDB failed");
		log_PR_error();
		error = true;
		goto cleanup_derCert;
	}
	{

	CERTCertificate *cert = CERT_FindCertByDERCert(handle, derCert);
	if (!cert) {
		log("CERT_FindCertByDERCert failed");
		log_PR_error();
		error = true;
		goto cleanup_derCert;
	}

	PK11SlotList *list = PK11_GetAllSlotsForCert(cert, NULL);
	if (!list) {
		log("PK11_GetAllSlotsForCert failed");
		error = true;
		goto cleanup_cert;
	}

	if (req.isMember("password")) {
		const char *pw = req["password"].asCString();
		SECStatus status = SECSuccess;
		int n_login = 0;
		int n_bad_pwd = 0;
		for (PK11SlotListElement *el = list->head; el; el = el->next) {
			PK11SlotInfo *slot = el->slot;
			if (!PK11_NeedLogin(slot))
				continue;
			n_login++;
			SECStatus rv = PK11_CheckUserPassword(slot, pw);
			if (rv != SECSuccess) {
				log("PK11_CheckUserPassword failed");
				if (PR_GetError() != SEC_ERROR_BAD_PASSWORD) {
					status = rv;
					break;
				} else
					n_bad_pwd++;
			}
		}
		if (status != SECSuccess
			|| (n_login > 0 && n_login == n_bad_pwd)) {
			res["result"] = ERROR_AUTHENTICATION_FAILED;
			goto cleanup_list;
		}
	}
	{

	std::string data_b64 = req["data"].asString();
	SECItem *data = data_b64.length()?
		NSSBase64_DecodeBuffer(NULL, NULL, data_b64.c_str(),
			data_b64.length()):
		SECITEM_AllocItem(NULL, NULL, 0);
	if (!data) {
		log("Could not decode data");
		error = true;
		goto cleanup_list;
	}

	unsigned char digest_buf[HASH_LENGTH_MAX];
//sha1 is default
//HASH_AlgSHA256
	SECItem digest = {.type = siBuffer, .data = digest_buf,
		.len = SHA1_LENGTH};
	if (HASH_HashBuf(HASH_AlgSHA1, digest.data, data->data, data->len)
		!= SECSuccess)
		error = true;

	SECITEM_FreeItem(data, PR_TRUE);

	if (error)
		goto cleanup_list;

//SEC_OID_SHA256;
	SEC_PKCS7ContentInfo *cinfo = SEC_PKCS7CreateSignedData(cert,
		certUsageEmailSigner, NULL, SEC_OID_SHA1, &digest, NULL, NULL);
	if (!cinfo) {
		log("SEC_PKCS7CreateSignedData failed");
		log_PR_error();
		error = true;
		goto cleanup_list;
	}

	if (SEC_PKCS7IncludeCertChain(cinfo, NULL) != SECSuccess) {
		log("SEC_PKCS7IncludeCertChain failed");
		log_PR_error();
		error = true;
		goto cleanup_cinfo;
	}

	if (SEC_PKCS7AddSigningTime(cinfo) != SECSuccess) {
		log("SEC_PKCS7AddSigningTime failed");
		log_PR_error();
		error = true;
		goto cleanup_cinfo;
	}
	{

	std::string p7_str;
	if (SEC_PKCS7Encode(cinfo, outputfn, &p7_str, NULL, NULL, NULL)
		!= SECSuccess) {
		log("SEC_PKCS7Encode failed");
		log_PR_error();
		error = true;
		goto cleanup_cinfo;
	}

	SECItem p7 = {.type = siBuffer, .data = (unsigned char *)p7_str.c_str(),
		.len = (unsigned int)p7_str.length()};
	char *result = NSSBase64_EncodeItem(NULL, NULL, 0, &p7);
	if (!result) {
		error = true;
		goto cleanup_cinfo;
	}
	res["result"] = result;
	free(result);

	}
cleanup_cinfo:
	SEC_PKCS7DestroyContentInfo(cinfo);

	}
cleanup_list:
	PK11_FreeSlotList(list);

cleanup_cert:
	CERT_DestroyCertificate(cert);

	}
cleanup_derCert:
	SECITEM_FreeItem(derCert, PR_TRUE);
	return error;
}

static bool read_request(Json::Value &req, bool &end) {
	msg_size size;
	std::cin.read(size.c, 4);
	end = !std::cin.good();
	if (end)
		return !std::cin.eof() || std::cin.gcount();
	char *buf = new char[size.u + 1];
	std::cin.read(buf, size.u);
	bool error = !std::cin.good();
	buf[size.u] = '\0';

	if (!error) {
		Json::Reader reader;
		if (!reader.parse(buf, buf + size.u, req))
			error = true;
	}

	delete[] buf;

	return error;
}

static bool write_response(Json::Value &res) {
	Json::FastWriter writer;
// This is not allowed in the Trusty environment
//	writer.omitEndingLineFeed();
	std::string str = writer.write(res);
	msg_size size;
	size.u = str.length();

	std::cout.write(size.c, 4);
	std::cout.write(str.c_str(), size.u);
	return !std::cout.good();
}

static bool web_extension_protocol(void) {
	for (;;) {
		bool end;
		Json::Value req;
		if (read_request(req, end))
			return true;
		if (end)
			return false;

		bool error = false;
		Json::Value res;
		std::string command = req["command"].asString();
		if (command == "get_certificates")
			error = get_user_certs(req, res);
		else if (command == "initialize")
			error = initialize(req, res);
		else if (command == "sign_data")
			error = sign_text(req, res);
		else {
			log("Unknown command " + command);
			error = true;
		}

		if (error) {
			res.clear();
			res["result"] = ERROR_INTERNAL;
		}

		if (write_response(res) || error)
			return true;
	}
}

static char *detect_configdir(void) {
	const char *envvar = getenv("MOZ_CRASHREPORTER_EVENTS_DIRECTORY");
	if (!envvar)
		return NULL;
	static const char SUBDIRS[] = "/crashes/events";
	const char *end = strstr(envvar, SUBDIRS);
	if (!end)
		return NULL;
	for (const char *end2 = strstr(end + strlen(SUBDIRS), SUBDIRS); end2;
		end2 = strstr(end + strlen(SUBDIRS), SUBDIRS))
		end = end2;
	return strndup(envvar, end - envvar);
}

int main(void) {
	PR_Init(PR_USER_THREAD, PR_PRIORITY_LOW, 0);

	bool error = false;

	char *configdir = detect_configdir();
	if (!configdir) {
		log("Could not detect profile directory");
		error = true;
		goto cleanup_pr;
	}

	if (NSS_Init(configdir) != SECSuccess) {
		log("NSS_Init failed");
		error = true;
		goto cleanup_configdir;
	}
	{

	if (web_extension_protocol())
		error = true;

	if (NSS_Shutdown() != SECSuccess)
		error = true;

	}
cleanup_configdir:
	free(configdir);

cleanup_pr:
	if (PR_Cleanup() != PR_SUCCESS)
		error = true;
	return error? EXIT_FAILURE: EXIT_SUCCESS;
}
