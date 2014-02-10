### Copyright (c) 2013, The Tor Project, Inc.
### See src/LICENSE for licensing information.

EXT_NAME=tor-launcher
VERSION:=`grep em:version src/install.rdf | sed -e 's/[<>]/	/g' | cut -f3`
XPI_NAME:=$(shell echo "$(EXT_NAME)-$(VERSION).xpi")
STANDALONE_NAME=$(EXT_NAME)-standalone
STANDALONE_TARBALL=$(shell echo "$(STANDALONE_NAME)-$(VERSION).tar.gz")

AVAIL_TARGETS=help package standalone clean

ifeq ($(VERBOSE),1)
	ZIP=zip
	TAR=tar -v
else
	ZIP=zip -q
	TAR=tar
endif
 
help:
	@echo "Available targets:";												\
	for t in $(AVAIL_TARGETS); do											\
		echo "  make $$t";													\
	done

pkg-prepare:	clean
	@mkdir -p pkg

package:	pkg-prepare
	@(cd src; $(ZIP) -X9r "../pkg/$(XPI_NAME)" ./ -x "*.diff")
	@echo "Created package pkg/$(XPI_NAME)"

standalone:	pkg-prepare
	$(eval TMP="$(shell mktemp -d "/tmp/$(STANDALONE_NAME).XXXXXX")")
	@mkdir -p "$(TMP)/$(STANDALONE_NAME)"
	@cp -a "src/"* "$(TMP)/$(STANDALONE_NAME)"
	@cp application.ini.in "$(TMP)/$(STANDALONE_NAME)/application.ini"
	@sed -i	-e "s/__VERSION__/$(VERSION)/" \
		-e "s/__DATE__/`date '+%Y%m%d'`/" \
		"$(TMP)/$(STANDALONE_NAME)/application.ini"
	@$(TAR) --exclude "*.diff" -czf "pkg/$(STANDALONE_TARBALL)" \
		-C "$(TMP)" "$(STANDALONE_NAME)"
	@rm -rf "$(TMP)"
	@echo "Created standalone package pkg/$(STANDALONE_TARBALL)"

clean:
	@rm -f	"pkg/$(XPI_NAME)" \
		"pkg/$(STANDALONE_TARBALL)"

zip:
	@TMPFILE=/tmp/$(EXT_NAME)-`date '+%Y-%m-%d-%s'`.zip;			 		\
	CURDIR=`pwd`;													   		\
	BASEDIR=`basename $$CURDIR`;											\
	cd ..; zip -q -r $$TMPFILE $$BASEDIR -x $$BASEDIR/build/\*;		 		\
	rm $$TMPFILE

.PHONY: help clean zip
