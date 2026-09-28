#!/usr/bin/env node
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';

const CACHE_DIR = path.join(os.homedir(), '.gitleaks-cache');

function showCleanupInfo(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    return;
  }

  const versions = fs.readdirSync(CACHE_DIR).filter(dir => dir.startsWith('v'));

  if (versions.length === 0) {
    return;
  }

  let totalSize = 0;
  versions.forEach(version => {
    const versionPath = path.join(CACHE_DIR, version);
    try {
      const binaryPath = path.join(versionPath, 'gitleaks');
      if (fs.existsSync(binaryPath)) {
        const stats = fs.statSync(binaryPath);
        totalSize += stats.size;
      }
    } catch {
      // Ignore errors.
    }
  });

  const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);

  logger.print('\n' + '='.repeat(60));
  logger.print('🗑️  Gitleaks Binary Cleanup');
  logger.print('='.repeat(60));
  logger.print(`\nFound ${versions.length} cached Gitleaks version(s) using ${sizeMB} MB:`);
  logger.print(`Location: ${CACHE_DIR}\n`);

  versions.forEach(v => {
    logger.print(`  • ${v.replace('v', '')}`);
  });

  logger.print('\n💡 To free up disk space, run:');
  logger.print(`   rm -rf ${CACHE_DIR}`);
  logger.print('\n   Or use:');
  logger.print('   npx gitleaks-secret-scanner --clean-all');
  logger.print('\n' + '='.repeat(60) + '\n');
}

if (process.env.npm_config_global !== 'true') {
  try {
    showCleanupInfo();
  } catch {
    // Silently fail - don't break uninstall process.
  }
}
