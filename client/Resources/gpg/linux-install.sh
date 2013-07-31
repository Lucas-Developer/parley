#!/bin/bash

TARGET_DIR=$(cd linux; pwd)

cd gnupg-1.4.13

./configure --prefix=$TARGET_DIR

make
make install

exit
