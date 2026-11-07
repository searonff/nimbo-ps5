#!/bin/bash
cd /home/claude/test
[ -f run.mock.pid ] && kill $(cat run.mock.pid) 2>/dev/null
[ -f run.nimbo.pid ] && kill $(cat run.nimbo.pid) 2>/dev/null
sleep 0.5
mkdir -p run/data run/ssd run/usb
python3 mock_torbox.py 9900 > run/mock.log 2>&1 &
echo $! > run.mock.pid
sleep 0.5
NIMBO_TORBOX_BASE=http://127.0.0.1:9900/v1/api NIMBO_DATA=run/data NIMBO_PORT=8090 \
NIMBO_ROOTS="SSD interno=/home/claude/test/run/ssd;USB 0=/home/claude/test/run/usb" \
NIMBO_DEFAULT_DEST=/home/claude/test/run/ssd/Nimbo NIMBO_APPS_ROOT=/home/claude/test/run/user \
/home/claude/nimbo-ps5/nimbo-pc > run/nimbo.log 2>&1 &
echo $! > run.nimbo.pid
sleep 0.8
