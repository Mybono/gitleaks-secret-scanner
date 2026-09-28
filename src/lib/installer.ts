import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as tar from 'tar';
import unzipper from 'unzipper';
import type { PackageInfo, ScanConfig } from '../types.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let packageInfo: PackageInfo = {
  name: 'gitleaks-secret-scanner',
  version: '2.1.1',
  repository: { url: 'https://github.com/Mybono/gitleaks-secret-scanner' },
};

try {
  const packagePath = path.join(__dirname, '..', '..', 'package.json');
  if (fs.existsSync(packagePath)) {
    packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  }
} catch (e) {
  logger.warn(`⚠️ Error loading package.json: ${(e as Error).message}`);
}

const CACHE_DIR = path.join(os.homedir(), '.gitleaks-cache');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

async function fetchLatestVersion(): Promise<string> {
  return new Promise(resolve => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/gitleaks/gitleaks/releases/latest',
      method: 'GET',
      headers: {
        'User-Agent': `${packageInfo.name}/${packageInfo.version}`,
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
          logger.warn('⚠️ Could not fetch latest version, using fallback');

          return resolve('8.30.0');
        }

        try {
          const release = JSON.parse(data);
          const version = release.tag_name.replace('v', '');
          resolve(version);
        } catch {
          logger.warn('⚠️ Could not parse latest version, using fallback');
          resolve('8.30.0');
        }
      });
    });

    req.on('error', () => {
      logger.warn('⚠️ Network error fetching latest version, using fallback');
      resolve('8.30.0');
    });

    req.setTimeout(5000, () => {
      req.destroy();
      logger.warn('⚠️ Timeout fetching latest version, using fallback');
      resolve('8.30.0');
    });

    req.end();
  });
}

export async function installGitleaks(config: Pick<ScanConfig, 'version'>): Promise<string> {
  const platform = os.platform();
  const arch = os.arch();
  const binaryName = platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';

  let version = config.version;

  if (!version) {
    version = await fetchLatestVersion();
  }

  logger.info(`Using Gitleaks version: ${version}`);

  const versionDir = path.join(CACHE_DIR, `v${version}`);
  const binaryPath = path.join(versionDir, binaryName);

  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  if (!fs.existsSync(versionDir)) {
    fs.mkdirSync(versionDir, { recursive: true });
  }

  try {
    const fileName = getFileName(version, platform, arch);
    const downloadUrl = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/${fileName}`;
    await downloadAndExtract(downloadUrl, versionDir, platform);
    if (platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }

    return binaryPath;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger.error(`\n❌ Failed to download or extract Gitleaks: ${err.message}\n`);

    if (err.message.includes('404')) {
      logger.error(`⚠️  Binary not found for your system (platform: ${platform}, arch: ${arch})`);
      logger.print('\n📖 Manual Installation Options:\n');
      logger.print('1. Download directly from GitHub:');
      logger.print(`   https://github.com/gitleaks/gitleaks/releases/tag/v${version}`);
      logger.print('\n2. Use a different version:');
      logger.print('   npx gitleaks-secret-scanner --select-version');
      logger.print('\n3. Install Gitleaks globally and use it directly:');
      logger.print('   brew install gitleaks  # macOS');
      logger.print('   # or download from: https://github.com/gitleaks/gitleaks/releases\n');
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      logger.error('⚠️  Network error - unable to reach GitHub');
      logger.print('\n💡 Troubleshooting:\n');
      logger.print('1. Check your internet connection');
      logger.print("2. Check if you're behind a proxy or firewall");
      logger.print('3. Try again later');
      logger.print('4. Download manually from: https://github.com/gitleaks/gitleaks/releases\n');
    } else if (err.code === 'EACCES' || err.code === 'EPERM') {
      logger.error('⚠️  Permission denied - cannot write to cache directory');
      logger.print('\n💡 Solutions:\n');
      logger.print('1. Run with appropriate permissions');
      logger.print(`2. Check permissions on: ${CACHE_DIR}`);
      logger.print(`3. Try: sudo chown -R $(whoami) ${CACHE_DIR}\n`);
    } else {
      logger.print('\n💡 Troubleshooting:\n');
      logger.print('1. Try a different version: npx gitleaks-secret-scanner --select-version');
      logger.print('2. Check available versions: https://github.com/gitleaks/gitleaks/releases');
      logger.print(
        '3. Report this issue: https://github.com/Mybono/gitleaks-secret-scanner/issues\n',
      );
    }

    throw error;
  }
}

function getFileName(version: string, platform: NodeJS.Platform, arch: string): string {
  let osName: string;
  let archName: string;

  switch (platform) {
    case 'darwin':
      osName = 'darwin';
      break;
    case 'linux':
      osName = 'linux';
      break;
    case 'win32':
      osName = 'windows';
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  switch (arch) {
    case 'x64':
      archName = 'x64';
      break;
    case 'arm64':
      archName = 'arm64';
      break;
    case 'arm':
      archName = 'armv7';
      logger.warn(
        "⚠️ Detected 'arm' architecture. Assuming 'armv7'. If you need 'armv6', this may fail.",
      );
      break;
    case 'ia32':
      archName = 'x32';
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}.`);
  }

  const ext = osName === 'windows' ? 'zip' : 'tar.gz';

  return `gitleaks_${version}_${osName}_${archName}.${ext}`;
}

async function downloadAndExtract(
  url: string,
  targetDir: string,
  platform: NodeJS.Platform,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': `${packageInfo.name}/${packageInfo.version}`,
    };

    const request = https.get(url, { headers }, response => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        downloadAndExtract(response.headers.location, targetDir, platform)
          .then(resolve)
          .catch(reject);

        return;
      }
      if (response.statusCode !== 200) {
        response.resume();

        return reject(new Error(`Download failed with status code: ${response.statusCode}`));
      }

      const extractor: NodeJS.WritableStream =
        platform === 'win32' ? unzipper.Extract({ path: targetDir }) : tar.x({ C: targetDir });

      response
        .pipe(extractor)
        .on('finish', () => {
          resolve();
        })
        .on('error', (err: Error) => {
          const archiveType = platform === 'win32' ? 'ZIP' : 'TAR';
          reject(new Error(`${archiveType} extraction failed: ${err.message}`));
        });
    });

    request.on('error', err => {
      reject(new Error(`Download request failed: ${err.message}`));
    });
  });
}
