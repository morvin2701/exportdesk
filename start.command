#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then npm install --omit=dev; fi
(sleep 1.5 && open http://localhost:4000) &
node server/index.js
