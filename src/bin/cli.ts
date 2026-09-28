#!/usr/bin/env node
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import { showAttribution, version, options } from '../lib/attribution.js';
import { loadConfig } from '../lib/config.js';
import { setupHusky } from '../lib/husky-installer.js';
import { installGitleaks } from '../lib/installer.js';
import { runScan, runPassThroughCommand } from '../lib/scanner.js';
import { selectVersion, manageVersions } from '../lib/version-manager.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MainResult {
  exitCode?: number;
  foundSecrets?: boolean;
}

async function initConfig(): Promise<void> {
  const targetPath = path.join(process.cwd(), '.gitleaks.toml');
  if (fs.existsSync(targetPath)) {
    logger.print('ℹ️ .gitleaks.toml already exists in this project');

    return;
  }
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'default.toml');
  await fs.copy(templatePath, targetPath);
  logger.print('✅ Created .gitleaks.toml configuration file');
}

async function showEngineVersion(): Promise<void> {
  try {
    const config = await loadConfig();
    const binaryPath = await installGitleaks(config);

    logger.print('\n📊 Gitleaks Engine Information:\n');

    try {
      const versionOutput = execFileSync(binaryPath, ['version'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      logger.print(`   Engine Version: ${versionOutput.trim()}`);
    } catch {
      logger.print('   Engine Version: Could not determine');
    }

    logger.print(`   Binary Location: ${binaryPath}`);

    const exists = fs.existsSync(binaryPath);
    logger.print(`   Binary Exists: ${exists ? '✅ Yes' : '❌ No'}`);

    const cacheDir = path.join(os.homedir(), '.gitleaks-cache');
    logger.print(`   Cache Directory: ${cacheDir}`);

    if (fs.existsSync(cacheDir)) {
      const versions = fs
        .readdirSync(cacheDir)
        .filter(dir => dir.startsWith('v'))
        .map(dir => dir.replace('v', ''));

      if (versions.length > 0) {
        logger.print(`   Installed Versions: ${versions.join(', ')}`);
      } else {
        logger.print('   Installed Versions: None');
      }
    }

    logger.print('');
  } catch (error) {
    logger.error(`\n❌ Error checking engine version: ${(error as Error).message}\n`);
  }
}

async function cleanAllVersions(): Promise<void> {
  const cacheDir = path.join(os.homedir(), '.gitleaks-cache');

  if (!fs.existsSync(cacheDir)) {
    logger.print('\nℹ️  No cached Gitleaks versions found.\n');

    return;
  }

  const versions = fs.readdirSync(cacheDir).filter(dir => dir.startsWith('v'));

  if (versions.length === 0) {
    logger.print('\nℹ️  No cached Gitleaks versions found.\n');

    return;
  }

  logger.print('\n🗑️  Delete All Cached Versions');
  logger.print('────────────────────────────────');
  logger.print(`Found ${versions.length} cached version(s):`);
  versions.forEach(v => logger.print(`  - ${v.replace('v', '')}`));
  logger.print(`\nCache location: ${cacheDir}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question('Delete all cached versions? (y/N): ', answer => {
      rl.close();

      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        try {
          fs.removeSync(cacheDir);
          logger.print(`\n✅ Deleted all ${versions.length} cached version(s).\n`);
        } catch (error) {
          logger.error(`\n❌ Failed to delete cache: ${(error as Error).message}\n`);
        }
      } else {
        logger.print('\n❌ Cancelled. No versions deleted.\n');
      }

      resolve();
    });
  });
}

async function main(): Promise<MainResult> {
  const args = process.argv.slice(2);
  if (args.includes('--options')) {
    options();

    return { exitCode: 0 };
  }
  if (args.includes('--about')) {
    showAttribution();

    return { exitCode: 0 };
  }
  if (args.includes('--version')) {
    version();

    return { exitCode: 0 };
  }
  if (args.includes('--engine-version')) {
    await showEngineVersion();

    return { exitCode: 0 };
  }
  if (args.includes('--init')) {
    await initConfig();

    return { exitCode: 0 };
  }
  if (args.includes('--setup-husky')) {
    const commandIndex = args.indexOf('--command');
    const customCommand =
      commandIndex !== -1 && args[commandIndex + 1] ? args[commandIndex + 1] : undefined;

    await setupHusky({ command: customCommand });

    return { exitCode: 0 };
  }
  if (args.includes('--select-version')) {
    const selectedVersion = await selectVersion();
    await installGitleaks({ version: selectedVersion });
    logger.print(`✅ Gitleaks version ${selectedVersion} installed successfully.`);

    return { exitCode: 0 };
  }
  if (args.includes('--manage-versions')) {
    await manageVersions();

    return { exitCode: 0 };
  }
  if (args.includes('--clean-all')) {
    await cleanAllVersions();

    return { exitCode: 0 };
  }
  if (args.includes('--install-only')) {
    const config = await loadConfig();
    await installGitleaks(config);
    logger.print('✅ Gitleaks installation complete.');

    return { exitCode: 0 };
  }

  const passThroughCommands = ['help', 'version', 'protect'];
  if (passThroughCommands.includes(args[0] ?? '') || args.includes('--help')) {
    const binaryPath = await installGitleaks({ version: null });
    const exitCode = await runPassThroughCommand(binaryPath, args);

    return { exitCode };
  }

  const config = await loadConfig();
  const binaryPath = await installGitleaks(config);
  const foundSecrets = await runScan(binaryPath, config);

  return { foundSecrets };
}

main()
  .then(({ foundSecrets, exitCode }) => {
    if (foundSecrets === true) {
      logger.error('\n❌ Secrets were detected.');
      process.exit(1);
    } else if (foundSecrets === false) {
      logger.print('\n✅ Scan complete. No secrets found.');
      process.exit(0);
    } else {
      process.exit(exitCode || 0);
    }
  })
  .catch((error: NodeJS.ErrnoException) => {
    logger.error(`\n❌ An unexpected error occurred: ${error.message}\n`);

    if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
      logger.print('💡 File not found. Possible solutions:\n');
      logger.print("1. Make sure you're in the correct directory");
      logger.print('2. Check if the file path is correct');
      logger.print('3. Verify the repository is initialized: git status\n');
    } else if (error.message.includes('permission') || error.code === 'EACCES') {
      logger.print('💡 Permission error. Try:\n');
      logger.print('1. Check file/directory permissions');
      logger.print('2. Run with appropriate user privileges');
      logger.print('3. Contact your system administrator\n');
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      logger.print('💡 Network error. Possible solutions:\n');
      logger.print('1. Check your internet connection');
      logger.print('2. Verify you can access GitHub.com');
      logger.print('3. Check proxy/firewall settings');
      logger.print('4. Try again later\n');
    } else {
      logger.print('💡 For help:\n');
      logger.print('1. View options: npx gitleaks-secret-scanner --options');
      logger.print('2. Check documentation: https://github.com/Mybono/gitleaks-secret-scanner');
      logger.print('3. Report issues: https://github.com/Mybono/gitleaks-secret-scanner/issues\n');
    }

    if (process.env.DEBUG) {
      logger.error('\n📋 Stack trace (DEBUG mode):\n', error);
    }

    process.exit(2);
  });
