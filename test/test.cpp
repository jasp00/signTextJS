// signTextJS plus test for native back end
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+ WITH reinstatement-exception

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <stdint.h>
#include <unistd.h>
#include <json/json.h>

#include "config.h"

union msg_size {
	uint32_t u;
	char c[4];
};

static void read_response(Json::Value &res, FILE *stream) {
	msg_size size;
	if (fread(size.c, 4, 1, stream) != 1)
		exit(EXIT_FAILURE);
	char *buf = new char[size.u + 1];
	if (fread(buf, 1, size.u, stream) != size.u)
		exit(EXIT_FAILURE);
	buf[size.u] = '\0';

	Json::Reader reader;
	if (!reader.parse(buf, buf + size.u, res))
		exit(EXIT_FAILURE);

	delete[] buf;
}

static void write_request(Json::Value &req, FILE *stream) {
	Json::FastWriter writer;
// This is not allowed in the Trusty environment
//	writer.omitEndingLineFeed();
	std::string str = writer.write(req);
	msg_size size;
	size.u = str.length();

	if (fwrite(size.c, 4, 1, stream) != 1)
		exit(EXIT_FAILURE);
	if (fwrite(str.c_str(), 1, size.u, stream) != size.u)
		exit(EXIT_FAILURE);
	if (fflush(stream))
		exit(EXIT_FAILURE);
}

static void protocol_test(FILE *bei, FILE *beo) {
	Json::Value req;
	Json::Value res;

	req["command"] = "initialize";
	req["debug"] = true;

	write_request(req, bei);
	read_response(res, beo);

	if (res["version"].asString() != WEB_EXTENSION_VERSION) {
		std::cerr << "Version mismatch" << std::endl;
		exit(EXIT_FAILURE);
	}

	req.clear();
	res.clear();

	req["command"] = "get_certificates";

	write_request(req, bei);
	read_response(res, beo);

	if (!res["certificates"][0].isMember("der")) {
		std::cerr << "Failed to get certificate" << std::endl;
		exit(EXIT_FAILURE);
	}
	std::string der = res["certificates"][0]["der"].asString();

	req.clear();
	res.clear();

	req["command"] = "sign_data";
	req["certificate"] = der;
	req["data"] = "SGVsbG8sIHdvcmxkIQo=";

	write_request(req, bei);
	read_response(res, beo);

	static const char ERROR[] = "error:";
	if (!res["result"].asString().compare(0, strlen(ERROR), ERROR)) {
		std::cerr << "Signature error" << std::endl;
		exit(EXIT_FAILURE);
	}
	std::cout << "Test passed" << std::endl;
}

int main(int argc, char **argv) {
	if (argc != 2)
		return EXIT_FAILURE;

	int back_end_input[2];
	int back_end_output[2];

	if (pipe(back_end_input))
		exit(EXIT_FAILURE);
	if (pipe(back_end_output))
		exit(EXIT_FAILURE);

	switch (fork()) {
	case -1:
		exit(EXIT_FAILURE);
	case 0:
		if (dup2(back_end_input[0], STDIN_FILENO) == -1)
			exit(EXIT_FAILURE);
		if (dup2(back_end_output[1], STDOUT_FILENO) == -1)
			exit(EXIT_FAILURE);
		for (int i = 0; i < 2; i++) {
			if (close(back_end_input[i]))
				exit(EXIT_FAILURE);
			if (close(back_end_output[i]))
				exit(EXIT_FAILURE);
		}
		execl(argv[1], argv[1], (char *)NULL);
		exit(EXIT_FAILURE);
	}

	if (close(back_end_input[0]))
		exit(EXIT_FAILURE);
	if (close(back_end_output[1]))
		exit(EXIT_FAILURE);

	FILE *bei_file = fdopen(back_end_input[1], "wb");
	if (!bei_file)
		exit(EXIT_FAILURE);
	FILE *beo_file = fdopen(back_end_output[0], "rb");
	if (!beo_file)
		exit(EXIT_FAILURE);

	protocol_test(bei_file, beo_file);

	if (fclose(bei_file))
		exit(EXIT_FAILURE);
	if (fclose(beo_file))
		exit(EXIT_FAILURE);

	return EXIT_SUCCESS;
}
