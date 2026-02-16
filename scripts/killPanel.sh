#!/bin/bash
# Kill all processes on port 4100 (panel server)

PIDS=$(lsof -ti:4100)

if [ -z "$PIDS" ]; then
  echo "✅ No processes found on port 4100"
  exit 0
fi

echo "🔍 Found processes on port 4100: $PIDS"
echo "🛑 Killing processes..."

for PID in $PIDS; do
  kill -9 $PID 2>/dev/null && echo "   ✓ Killed PID $PID" || echo "   ✗ Failed to kill PID $PID"
done

echo "✅ Port 4100 is now free"
