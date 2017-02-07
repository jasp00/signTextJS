// Synchronization server for XMLHttpRequest clients
// Copyright: 2017 Javier Serrano Polo <javier@jasp.net>
// License: GPL-3.0+

"use strict";

let prefs = require("sdk/simple-prefs").prefs;
let runtime = require("sdk/system/runtime");

let { Cu } = require("chrome");

let { ctypes } = Cu.import("resource://gre/modules/ctypes.jsm", {});
let { console } = Cu.import("resource://gre/modules/devtools/Console.jsm", {});

let { setTimeout } = require("sdk/timers");

let gPrefix = "SyncServer: ";
function log(x) {
	if (prefs.debug)
		console.log(gPrefix + x);
}

const PF_INET = 2;
const AF_INET = PF_INET;
const SOCK_STREAM = 1;
const struct_sockaddr = ctypes.StructType("struct_sockaddr", [
	{"sa_family": ctypes.unsigned_short},
	{"sa_data": ctypes.ArrayType(ctypes.char, 14)}
]);
const struct_in_addr = ctypes.StructType("struct_in_addr", [
	{"s_addr": ctypes.uint32_t}
]);
const struct_sockaddr_in = ctypes.StructType("struct_sockaddr_in", [
	{"sin_family": ctypes.unsigned_short},
	{"sin_port": ctypes.uint16_t},
	{"sin_addr": struct_in_addr},
	{"sin_zero": ctypes.ArrayType(ctypes.unsigned_char,
		struct_sockaddr.size - ctypes.unsigned_short.size
		- ctypes.uint16_t.size - struct_in_addr.size)}
]);
const EAGAIN = 11;

let libc = null;

let __errno_location = null;
let accept = null;
let bind = null;
let close = null;
let getsockname = null;
let inet_aton = null;
let listen = null;
let ntohs = null;
let read = null;
let socket = null;
let write = null;

function declareFunction(name, library, args) {
	try {
		args.unshift(ctypes.default_abi);
		args.unshift(name);
		return library.declare.apply(library, args);
	}
	catch (error) {
		log("couldn't find function '" + name + "' to declare");
		throw error;
	}
}

function loadLibraries() {
	if (runtime.OS == "Linux")
		; // OK
	else if (runtime.OS == "WINNT")
		log("OS not supported yet");
	else
		log("OS not tested yet");
	// runtime.OS == "Darwin";

	try {
		libc = ctypes.open("libc.so.6");
	}
	catch (error) {
		log("opening libc failed: " + error);
		throw error;
	}

	__errno_location = declareFunction("__errno_location", libc,
		[ctypes.int.ptr]);
	accept = declareFunction("accept", libc, [ctypes.int, ctypes.int,
		struct_sockaddr.ptr, ctypes.int.ptr]);
	bind = declareFunction("bind", libc, [ctypes.int, ctypes.int,
		struct_sockaddr.ptr, ctypes.int]);
	close = declareFunction("close", libc, [ctypes.int, ctypes.int]);
	getsockname = declareFunction("getsockname", libc, [ctypes.int,
		ctypes.int, struct_sockaddr.ptr, ctypes.int.ptr]);
	inet_aton = declareFunction("inet_aton", libc, [ctypes.int,
		ctypes.char.ptr, struct_in_addr.ptr]);
	listen = declareFunction("listen", libc, [ctypes.int, ctypes.int,
		ctypes.int]);
	ntohs = declareFunction("ntohs", libc, [ctypes.uint16_t,
		ctypes.uint16_t]);
	read = declareFunction("read", libc, [ctypes.ssize_t, ctypes.int,
		ctypes.voidptr_t, ctypes.size_t]);
	socket = declareFunction("socket", libc, [ctypes.int, ctypes.int,
		ctypes.int, ctypes.int]);
	write = declareFunction("write", libc, [ctypes.ssize_t, ctypes.int,
		ctypes.voidptr_t, ctypes.size_t]);
}

function unloadLibraries() {
	if (libc)
		libc.close();
}

function ctypeStringToJSString(charPtr) {
	let jsString = "";
	while (charPtr.contents) {
		jsString += String.fromCharCode(charPtr.contents);
		charPtr = charPtr.increment();
	}
	return jsString;
}

function ctypeJSStringToString(jsString) {
	let charArray = ctypes.ArrayType(ctypes.char);
	let string = new charArray(jsString.length + 1);
	for (let i = 0; i < jsString.length; i++)
		string[i] = jsString.charCodeAt(i);
	string[jsString.length] = 0;
	return string;
}

function ctypeBufferToJSString(charPtr, length) {
	let jsString = "";
	for (let i = 0; i < length; i++) {
		jsString += String.fromCharCode(charPtr.contents);
		charPtr = charPtr.increment();
	}
	return jsString;
}

let gInitialized = false;
let gSocket = -1;
let gPort = 0;
let gConnSocket = -1;
let gAccepted = false;

exports.init = function() {
	if (gInitialized)
		return {error: false, port: gPort};

	let initError = false;
	log("initializing");
	try {
		loadLibraries();
	}
	catch (error) {
		log("loadLibraries failed: " + error);
		initError = true;
	}

	let sa = new struct_sockaddr_in;
	sa.sin_family = AF_INET;
	sa.sin_port = 0;
	if (!inet_aton("127.0.0.1", sa.sin_addr.address()))
		initError = true;
	for (let i = 0; i < sa.sin_zero.length; i++)
		sa.sin_zero[i] = 0;
	let s = socket(PF_INET, SOCK_STREAM, 0);
	if (s == -1)
		initError = true;
	if (bind(s, ctypes.cast(sa.address(), struct_sockaddr.ptr),
		struct_sockaddr_in.size))
		initError = true;
	let bound_sa = new struct_sockaddr_in;
	let bound_sa_len = new ctypes.int(struct_sockaddr_in.size);
	if (getsockname(s, ctypes.cast(bound_sa.address(),
		struct_sockaddr.ptr), bound_sa_len.address()))
		initError = true;
	let port = ntohs(bound_sa.sin_port);
	const MAXBACKLOG = 5;
	if (listen(s, MAXBACKLOG))
		initError = true;
	if (initError)
		close(s);
	gSocket = s;
	gPort = port;
	gInitialized = true;
	return {error: initError, port: gPort};
};

exports.destroy = function() {
	if (!gInitialized)
		return;

	log("deinitializing");
	close(gSocket);
	gSocket = -1;
	unloadLibraries();
	gInitialized = false;
};

exports.handle = function(context) {
	// TODO: Check if in entries
	let s = accept(gSocket, null, null);
	if (s == -1) {
		let errno = __errno_location().contents;
		if (errno == EAGAIN) {
			//TODO: Check excessive timeout
			setTimeout(function() {exports.handle(context);}, 1000);
			return;
		}
		log("Unexpected error, errno " + errno);
	}
	// TODO: Read token; add entry, add start timestamp
	gConnSocket = s;
	gAccepted = true;
	// TODO: Clean up unused entries
}

exports.ack = function(context) {
	// TODO: Check if in entries
	if (!gAccepted) {
		setTimeout(function() {exports.ack(context);}, 1000);
		return;
	}
	let s = gConnSocket;
	let response = "HTTP/1.0 200 OK\r\n"
		+ "Access-Control-Allow-Origin: *\r\n"
		+ "Content-Length: 0\r\n"
		+ "\r\n";
	let string = ctypeJSStringToString(response);
	let result = write(s, string, response.length);
	// TODO: Resume write
	if (result < response.length)
		log("Did not write full response");
	close(s);
	gConnSocket = -1;
}
