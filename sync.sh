#!/bin/bash
# Sync walking-weddings between PC and MacBook
# Usage: ./sync.sh push   (PC -> MacBook)
#        ./sync.sh pull   (MacBook -> PC)

KEY="$HOME/.ssh/macbook_key"
REMOTE="ipat@192.168.0.150"
LOCAL="/c/Claude/walking-weddings/"
REMOTE_DIR="~/Claude/walking-weddings"

case "$1" in
  push)
    echo "Syncing PC -> MacBook..."
    ssh -i "$KEY" "$REMOTE" "rm -rf $REMOTE_DIR && mkdir -p $REMOTE_DIR"
    scp -i "$KEY" -r "$LOCAL"* "$REMOTE:$REMOTE_DIR/"
    echo "Done!"
    ;;
  pull)
    echo "Syncing MacBook -> PC..."
    rm -rf "$LOCAL"
    mkdir -p "$LOCAL"
    scp -i "$KEY" -r "$REMOTE:$REMOTE_DIR/"* "$LOCAL"
    echo "Done!"
    ;;
  *)
    echo "Usage: ./sync.sh push|pull"
    echo "  push = PC -> MacBook"
    echo "  pull = MacBook -> PC"
    ;;
esac
