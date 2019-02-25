test: ../test.cpp ../config.h
	g++ -Wall -O2 -g -I/usr/include/jsoncpp -o $@ $< -ljsoncpp

../config.h: ../../src/config.h
	cp -a $< $@

nssdb:
	PATH="$$PATH$${PATH:+:}/usr/local/opt/nss/bin" ../setup-nssdb

check: nssdb test
	./runtest

clean:
	rm -fr nssdb test ../config.h

.PHONY: check clean
