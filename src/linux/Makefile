signtextjs_plus: signtextjs_plus.cpp config.h
	g++ -Wall -O2 -g -I/usr/include/jsoncpp -I/usr/include/nspr -ljsoncpp \
		-lnspr4 -lnss3 -lsmime3 -o $@ $<

config.h: ../../webextension/manifest.json
	./gen-config < $< > $@
