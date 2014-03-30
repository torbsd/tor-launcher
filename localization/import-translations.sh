#!/bin/sh

BUNDLE_LOCALES="ar de es fa fr it ko nl pl pt ru tr vi zh-CN"

# XXX: Basque (eu) by request in #10687.
# This is not used for official builds, but should remain 
# so Basque XPIs can be build independently. We can do
# this for other languages too, if anyone requests this
# and translations are available.
BUNDLE_LOCALES="$BUNDLE_LOCALES eu ja sv"

if [ -d translation ];
then
  cd translation
  git fetch origin
  cd ..
else
  git clone https://git.torproject.org/translation.git
fi

cd translation
for i in $BUNDLE_LOCALES
do
  UL="`echo $i|tr - _`"
  mkdir -p ../../src/chrome/locale/$i/

  git checkout tor-launcher-network-settings
  git merge origin/tor-launcher-network-settings
  cp $UL/network-settings.dtd ../../src/chrome/locale/$i/

  git checkout tor-launcher-progress
  git merge origin/tor-launcher-progress
  cp $UL/progress.dtd ../../src/chrome/locale/$i/

  git checkout tor-launcher-properties
  git merge origin/tor-launcher-properties
  cp $UL/torlauncher.properties ../../src/chrome/locale/$i/
done
