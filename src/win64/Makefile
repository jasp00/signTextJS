signtextjs_plus.exe: ../signtextjs_plus.cpp ../config.h
	x86_64-w64-mingw32-g++ -Wall -O2 -g \
		-I/usr/x86_64-w64-mingw32/include/jsoncpp \
		-I/usr/x86_64-w64-mingw32/include/nspr \
		-o $@ $< -ljsoncpp -lnspr4 -lnss3 -lsmime3

../config.h: ../../webextension/manifest.json
	../gen-config < $< > $@

clean:
	rm -f signtextjs_plus.exe ../config.h

.PHONY: clean
