#!/usr/bin/env bash

BACKUP_SERVER_URL=$1
BACKUP_SERVER_USERNAME=$2
BACKUP_SERVER_PASSWORD=$3

mkdir -p backups

echo Checking backup on "$BACKUP_SERVER_URL/latest"

LATEST_BACKUP_URL=`curl -L -u "$BACKUP_SERVER_USERNAME:$BACKUP_SERVER_PASSWORD" "$BACKUP_SERVER_URL/latest"`
echo Downloading latest backup from url $LATEST_BACKUP_URL
pushd backups
  curl -L -u "$BACKUP_SERVER_USERNAME:$BACKUP_SERVER_PASSWORD" $LATEST_BACKUP_URL -O -J
  echo "$(basename -- $LATEST_BACKUP_URL)" > latest.txt
popd
