#!/bin/sh

# Get the directory where this script is located
DIR="$(dirname "$0")"

# The path to the Electron executable relative to this script
ELECTRON_PATH="$DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

# Log everything to a file on the Desktop for debugging
LOG_FILE="$HOME/Desktop/native_host_log.txt"
echo "---" >> "$LOG_FILE"
echo "Script started at $(date)" >> "$LOG_FILE"
echo "Executing: $ELECTRON_PATH" >> "$LOG_FILE"

# Execute Electron and append its output to the log file
"$ELECTRON_PATH" "$DIR/main.js" >> "$LOG_FILE" 2>&1