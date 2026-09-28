#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const binFiles = [
  path.join(__dirname, 'cli.js'),
  path.join(__dirname, 'postinstall.js'),
  path.join(__dirname, 'preuninstall.js'),
  path.join(__dirname, 'set-permissions.js'),
];

binFiles.forEach(file => {
  if (fs.existsSync(file)) {
    try {
      fs.chmodSync(file, 0o755);
      logger.print(`Set execute permissions on ${path.basename(file)}`);
    } catch (error) {
      logger.warn(`Could not set permissions on ${file}: ${(error as Error).message}`);
    }
  }
});
