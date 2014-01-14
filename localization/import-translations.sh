#!/bin/sh

BUNDLE_LOCALES="ar de es fa fr it ja ko nl pl pt ru vi zh-CN"

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
