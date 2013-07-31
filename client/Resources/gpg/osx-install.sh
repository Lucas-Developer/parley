#!/bin/bash

#this is identical to linux-install for now (except for the paths)
#but it requires xcode compiler tools. we'll need to figure out a
#better way at some point

TARGET_DIR=$(cd osx; pwd)

cd gnupg-1.4.13

./configure --prefix=$TARGET_DIR

make
make install

exit
