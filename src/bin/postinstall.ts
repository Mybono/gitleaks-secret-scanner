#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { loadConfig } from '../lib/config.js';
import { setupHusky } from '../lib/husky-installer.js';
import { installGitleaks } from '../lib/installer.js';
import { logger } from '../utils/logger.js';

async function promptSetupHusky(): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    logger.print('\n🎯 Optional: Git Hook Setup');
    logger.print('─────────────────────────────');
    rl.question(
      'Would you like to setup git hooks to run Gitleaks on every commit? (y/N): ',
      answer => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      },
    );
  });
}

function isGitRepository(): boolean {
  try {
    return fs.existsSync(path.join(process.cwd(), '.git'));
  } catch {
    return false;
  }
}

function hasPackageJson(): boolean {
  try {
    return fs.existsSync(path.join(process.cwd(), 'package.json'));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  try {
    logger.print('\n🚀 Installing Gitleaks Secret Scanner...\n');

    const config = await loadConfig();
    await installGitleaks(config);
    logger.print('✅ Gitleaks installation complete.\n');

    const isProjectInstall = process.env.npm_config_global !== 'true';
    const isGitRepo = isGitRepository();
    const hasPkgJson = hasPackageJson();

    if (isProjectInstall && isGitRepo && hasPkgJson) {
      const shouldSetup = await promptSetupHusky();

      if (shouldSetup) {
        logger.print('');
        await setupHusky();
      } else {
        logger.print('\nℹ️  You can setup git hooks later by running:');
        logger.print('   npx gitleaks-secret-scanner --setup-husky\n');
      }
    } else if (isProjectInstall) {
      if (!isGitRepo) {
        logger.print('ℹ️  Not in a git repository.');
      }
      if (!hasPkgJson) {
        logger.print('ℹ️  No package.json found.');
      }
      if (!isGitRepo || !hasPkgJson) {
        logger.print(
          '   To setup git hooks, run from your project root: npx gitleaks-secret-scanner --setup-husky\n',
        );
      }
    }
  } catch (error) {
    logger.warn(`\n⚠️  Warning during installation: ${(error as Error).message}\n`);
  }
}

void main();
