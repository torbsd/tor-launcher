### Copyright (c) 2013, The Tor Project, Inc.
### See src/LICENSE for licensing information.

EXT_NAME=tor-launcher
XPI_NAME:=$(shell echo "$(EXT_NAME)-`grep em:version src/install.rdf | sed -e 's/[<>]/	/g' | cut -f3`.xpi")

AVAIL_TARGETS=help package clean

ifeq ($(VERBOSE),1)
	ZIP=zip
else
	ZIP=zip -q
endif
 
help:
	@echo "Available targets:";												\
	for t in $(AVAIL_TARGETS); do											\
		echo "  make $$t";													\
	done

package:	clean
	@mkdir -p pkg
	@(cd src; $(ZIP) -X9r "../pkg/$(XPI_NAME)" ./ -x "*.diff")
	@echo "Created package pkg/$(XPI_NAME)"

clean:
	@rm -f "pkg/$(XPI_NAME)"

zip:
	@TMPFILE=/tmp/$(EXT_NAME)-`date '+%Y-%m-%d-%s'`.zip;			 		\
	CURDIR=`pwd`;													   		\
	BASEDIR=`basename $$CURDIR`;											\
	cd ..; zip -q -r $$TMPFILE $$BASEDIR -x $$BASEDIR/build/\*;		 		\
	rm $$TMPFILE

.PHONY: help clean zip
