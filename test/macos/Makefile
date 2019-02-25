test: ../test.cpp ../config.h
	g++ -Wall -O2 -g -I/usr/include/jsoncpp -o $@ $< -ljsoncpp

../config.h: ../../src/config.h
	cp -a $< $@

check: test
	./runtest

clean:
	rm -f test ../config.h

.PHONY: check clean
