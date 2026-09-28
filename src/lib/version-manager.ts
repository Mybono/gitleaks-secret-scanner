import https from 'https';
import os from 'os';
import path from 'path';
import readline from 'readline';
import fs from 'fs-extra';
import type { AvailableVersion } from '../types.js';
import { logger } from '../utils/logger.js';

const CACHE_DIR = path.join(os.homedir(), '.gitleaks-cache');

/** Fetch available Gitleaks versions from GitHub API. */
export async function fetchAvailableVersions(limit = 20): Promise<AvailableVersion[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/gitleaks/gitleaks/releases?per_page=${limit}`,
      method: 'GET',
      headers: {
        'User-Agent': 'gitleaks-secret-scanner',
        Accept: 'application/vnd.github+json',
      },
    };

    const req = https.request(options, res => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub API returned status ${res.statusCode}`));
        }

        try {
          interface GitHubRelease {
            tag_name: string;
            name?: string;
            published_at: string;
            html_url: string;
            prerelease: boolean;
            draft: boolean;
          }

          const releases = JSON.parse(data) as GitHubRelease[];
          const versions: AvailableVersion[] = releases
            .filter(release => !release.prerelease && !release.draft)
            .map(release => ({
              version: release.tag_name.replace('v', ''),
              name: release.name || release.tag_name,
              published: release.published_at,
              url: release.html_url,
            }));
          resolve(versions);
        } catch (error) {
          reject(new Error(`Failed to parse GitHub API response: ${(error as Error).message}`));
        }
      });
    });

    req.on('error', error => {
      reject(new Error(`Failed to fetch versions from GitHub: ${error.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout - GitHub API took too long to respond'));
    });

    req.end();
  });
}

/** Display versions and prompt user to select one. */
async function promptVersionSelection(versions: AvailableVersion[]): Promise<string> {
  logger.print('\n📦 Available Gitleaks Versions:\n');

  versions.forEach((version, index) => {
    const date = new Date(version.published).toLocaleDateString();
    logger.print(`  ${index + 1}. ${version.version} (${date})`);
  });

  logger.print(`  ${versions.length + 1}. Cancel\n`);

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Select a version number: ', answer => {
      rl.close();

      const selection = parseInt(answer, 10);

      if (isNaN(selection) || selection < 1 || selection > versions.length + 1) {
        return reject(new Error('Invalid selection'));
      }

      if (selection === versions.length + 1) {
        logger.print('Installation cancelled.');

        return reject(new Error('USER_CANCELLED'));
      }

      const selectedVersion = versions[selection - 1]!.version;
      logger.print(`\n✅ Selected version: ${selectedVersion}\n`);
      resolve(selectedVersion);
    });
  });
}

/** Interactive version selection flow. */
export async function selectVersion(): Promise<string> {
  try {
    logger.print('🔍 Fetching available Gitleaks versions ...\n');
    const versions = await fetchAvailableVersions(20);

    if (versions.length === 0) {
      logger.error('⚠️  No versions found from GitHub API');
      logger.print('\n💡 Fallback Options:\n');
      logger.print('1. Check available versions manually:');
      logger.print('   https://github.com/gitleaks/gitleaks/releases\n');
      logger.print('2. Specify a version directly:');
      logger.print('   npx gitleaks-secret-scanner --gitleaks-version 8.30.0\n');
      logger.print(
        '3. Use the default latest version (retry later):\n   npx gitleaks-secret-scanner\n',
      );
      process.exit(1);
    }

    return await promptVersionSelection(versions);
  } catch (error) {
    const err = error as Error;
    if (err.message === 'USER_CANCELLED') {
      process.exit(0);
    }

    logger.error(`\n❌ Failed to fetch versions: ${err.message}\n`);

    if (err.message.includes('GitHub API') || err.message.includes('fetch')) {
      logger.print('💡 This usually happens due to:\n');
      logger.print('1. Network connectivity issues');
      logger.print('2. GitHub API rate limiting');
      logger.print('3. Firewall or proxy blocking GitHub\n');
      logger.print('📖 Alternative Options:\n');
      logger.print('1. Try again in a few minutes');
      logger.print('2. Check versions at: https://github.com/gitleaks/gitleaks/releases');
      logger.print('3. Specify version directly:');
      logger.print('   npx gitleaks-secret-scanner --gitleaks-version 8.30.0\n');
    }

    process.exit(1);
  }
}

/** List all cached Gitleaks versions. */
export function listCachedVersions(): string[] {
  if (!fs.existsSync(CACHE_DIR)) {
    return [];
  }

  return fs
    .readdirSync(CACHE_DIR)
    .filter(dir => dir.startsWith('v'))
    .map(dir => dir.replace('v', ''))
    .sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);

      for (let i = 0; i < 3; i++) {
        const diff = (bParts[i] ?? 0) - (aParts[i] ?? 0);
        if (diff !== 0) {
          return diff;
        }
      }

      return 0;
    });
}

/** Remove a specific cached version. */
export function removeCachedVersion(version: string): boolean {
  const versionDir = path.join(CACHE_DIR, `v${version}`);

  if (fs.existsSync(versionDir)) {
    fs.removeSync(versionDir);

    return true;
  }

  return false;
}

/** Clean up old versions, keeping only the specified number of latest versions. */
export function cleanOldVersions(keepCount = 3): string[] {
  const versions = listCachedVersions();

  if (versions.length <= keepCount) {
    return [];
  }

  const toRemove = versions.slice(keepCount);
  const removed: string[] = [];

  toRemove.forEach(version => {
    if (removeCachedVersion(version)) {
      removed.push(version);
    }
  });

  return removed;
}

/** Get the size of a cached version directory. */
function getCachedVersionSize(version: string): string {
  const versionDir = path.join(CACHE_DIR, `v${version}`);

  if (!fs.existsSync(versionDir)) {
    return '0 MB';
  }

  try {
    const stats = fs.statSync(path.join(versionDir, 'gitleaks'));
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);

    return `${sizeMB} MB`;
  } catch {
    return 'Unknown';
  }
}

/** Interactive version cleanup. */
export async function manageVersions(): Promise<void> {
  const versions = listCachedVersions();

  if (versions.length === 0) {
    logger.print('\nℹ️  No cached Gitleaks versions found.\n');

    return;
  }

  logger.print('\n📦 Cached Gitleaks Versions:\n');

  versions.forEach((version, index) => {
    const size = getCachedVersionSize(version);
    logger.print(`  ${index + 1}. ${version} (${size})`);
  });

  logger.print(`\nTotal versions: ${versions.length}`);
  logger.print(`Cache location: ${CACHE_DIR}\n`);

  if (versions.length === 1) {
    logger.print('💡 Only one version cached. No cleanup needed.\n');

    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    if (versions.length === 2) {
      rl.question('Delete the older version? [y/N]: ', answer => {
        rl.close();

        const shouldDelete = answer.trim().toLowerCase() === 'y';

        if (shouldDelete) {
          const removed = cleanOldVersions(1);
          if (removed.length > 0) {
            logger.print(`\n✅ Removed: ${removed[0]}\n`);
          }
        } else {
          logger.print('\n✅ Keeping both versions.\n');
        }

        resolve();
      });
    } else {
      const defaultKeep = 2;
      rl.question(`Clean up old versions? Keep latest [${defaultKeep}]: `, answer => {
        rl.close();

        const keepCount = answer.trim() === '' ? defaultKeep : parseInt(answer, 10);

        if (isNaN(keepCount) || keepCount < 1) {
          logger.print('\n❌ Invalid number. Aborting.\n');
          resolve();

          return;
        }

        const removed = cleanOldVersions(keepCount);

        if (removed.length > 0) {
          logger.print(`\n✅ Removed ${removed.length} old version(s):`);
          removed.forEach(v => logger.print(`   - ${v}`));
          logger.print('');
        } else {
          logger.print(`\n✅ Keeping all ${versions.length} version(s).\n`);
        }

        resolve();
      });
    }
  });
}
