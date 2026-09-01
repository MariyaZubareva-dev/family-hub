#!/usr/bin/env sh
set -eu
printf '%s\n' '== PHP syntax ==' 
find backend -name '*.php' -print0 | xargs -0 -n1 php -l
printf '%s\n' '== Frontend build (requires npm install) =='
cd frontend
npm run build
