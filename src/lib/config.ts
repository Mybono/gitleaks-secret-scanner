import fs from 'fs';
import path from 'path';
import toml from 'toml';
import type { ScanConfig, DiffMode } from '../types.js';
import { logger } from '../utils/logger.js';

const VALID_DIFF_MODES: DiffMode[] = ['staged', 'all', 'ci', 'history'];

const CLI_ONLY_FLAGS = [
  '--setup-husky',
  '--select-version',
  '--manage-versions',
  '--clean-all',
  '--command',
  '--install-only',
  '--init',
  '--options',
  '--about',
  '--engine-version',
];

const isFlagWithValue = (v: string | undefined): v is string => Boolean(v) && !v!.startsWith('--');

function loadRcConfig(config: ScanConfig): void {
  const rcPath = path.join(process.cwd(), '.gitleaksrc');
  if (!fs.existsSync(rcPath)) {
    return;
  }
  try {
    const rcConfig = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    Object.assign(config, rcConfig);
  } catch (error) {
    logger.warn(`⚠️ Could not parse .gitleaksrc: ${(error as Error).message}`);
    logger.info(
      'ℹ️  Continuing with default configuration. Check your .gitleaksrc file for JSON syntax errors.\n',
    );
  }
}

/** Applies a single CLI flag to `config`; returns how many extra args (i.e. the flag's value) were consumed. */
function applyArg(config: ScanConfig, arg: string, val: string | undefined): number {
  switch (arg) {
    case '--gitleaks-version':
      if (isFlagWithValue(val)) {
        config.version = val;

        return 1;
      }
      logger.warn('⚠️ --gitleaks-version flag requires a version number.');

      return 0;
    case '--html-report':
      if (isFlagWithValue(val)) {
        config.htmlReport = val;

        return 1;
      }
      config.htmlReport = 'gitleaks-report.html';

      return 0;
    case '--report-format':
    case '-f':
      if (isFlagWithValue(val)) {
        config.reportFormat = val;

        return 1;
      }
      logger.warn('⚠️ --report-format (-f) flag requires a format.');

      return 0;
    case '--report-path':
    case '-r':
      if (isFlagWithValue(val)) {
        config.reportPath = val;

        return 1;
      }
      logger.warn('⚠️ --report-path (-r) flag requires a path.');

      return 0;
    case '--diff-mode':
      if (isFlagWithValue(val)) {
        config.diffMode = val as DiffMode;

        return 1;
      }
      logger.warn('⚠️ --diff-mode flag requires a mode (staged/all/ci).');

      return 0;
    case '--depth':
      if (isFlagWithValue(val) && !isNaN(parseInt(val, 10))) {
        config.scanDepth = parseInt(val, 10);

        return 1;
      }
      logger.warn('⚠️ --depth flag requires a number.');

      return 0;
    default:
      return -1;
  }
}

function parseCliArgs(config: ScanConfig): string[] {
  const args = process.argv.slice(2);
  const remainingArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const val = args[i + 1];

    if (CLI_ONLY_FLAGS.includes(arg)) {
      if (arg === '--command' || arg === '--gitleaks-version') {
        i++;
      }
      continue;
    }

    const consumed = applyArg(config, arg, val);
    if (consumed === -1) {
      remainingArgs.push(arg);
    } else {
      i += consumed;
    }
  }

  return remainingArgs;
}

function loadTomlConfig(config: ScanConfig): void {
  const tomlPaths = ['.gitleaks.toml', 'gitleaks.toml', '.gitleaks/config.toml'];
  for (const tomlPath of tomlPaths) {
    const fullPath = path.join(process.cwd(), tomlPath);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    config.configPath = fullPath;
    try {
      const tomlContent = fs.readFileSync(fullPath, 'utf8');
      const parsed = toml.parse(tomlContent) as { version?: string };
      if (parsed.version && !config.version) {
        config.version = parsed.version;
      }
    } catch (error) {
      logger.warn(`⚠️ Could not parse TOML file: ${(error as Error).message}`);
      logger.info(`ℹ️  File: ${fullPath}`);
      logger.info(
        'ℹ️  Continuing without custom config. Check your .gitleaks.toml for syntax errors.\n',
      );
    }
    break;
  }
}

export async function loadConfig(): Promise<ScanConfig> {
  const config: ScanConfig = {
    version: null,
    configPath: null,
    htmlReport: null,
    reportFormat: null,
    reportPath: null,
    diffMode: 'staged',
    scanDepth: null,
    additionalArgs: [],
  };

  loadRcConfig(config);

  config.additionalArgs = parseCliArgs(config);

  if (!VALID_DIFF_MODES.includes(config.diffMode)) {
    logger.warn(`⚠️ Invalid diff mode: ${config.diffMode}. Defaulting to 'staged'.`);
    config.diffMode = 'staged';
  }

  loadTomlConfig(config);

  return config;
}
