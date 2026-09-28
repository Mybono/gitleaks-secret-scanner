#!/usr/bin/env node
'use strict';

// Committed as plain CommonJS (not under src/) so it exists and runs
// regardless of whether dist/ has been built yet. npm runs `postinstall` on
// every `npm ci`/`npm install`, including inside this repo's own CI before
// `npm run build` ever executes — at that point dist/ does not exist (it is
// gitignored), and requiring it directly would crash the install. A real
// end-user install always has dist/, since it ships in the published tarball
// (see package.json "files").
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const setPermissions = path.join(__dirname, '..', 'dist', 'bin', 'set-permissions.js');
  const postinstall = path.join(__dirname, '..', 'dist', 'bin', 'postinstall.js');

  if (!fs.existsSync(postinstall)) {
    return;
  }

  await import(pathToFileURL(setPermissions).href);
  await import(pathToFileURL(postinstall).href);
}

main();
