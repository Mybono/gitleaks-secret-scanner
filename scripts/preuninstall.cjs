#!/usr/bin/env node
'use strict';

// See postinstall.cjs for why this exists as a committed, non-built guard.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const preuninstall = path.join(__dirname, '..', 'dist', 'bin', 'preuninstall.js');

  if (!fs.existsSync(preuninstall)) {
    return;
  }

  await import(pathToFileURL(preuninstall).href);
}

main();
