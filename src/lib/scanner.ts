import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Leak, ScanConfig } from '../types.js';
import { logger } from '../utils/logger.js';
import { generateHtmlReport } from './report-generator.js';

const GIT = 'git';

export async function runScan(binaryPath: string, config: ScanConfig): Promise<boolean> {
  if (!fs.existsSync(binaryPath)) {
    throw new Error('Gitleaks binary missing');
  }

  if (config.isHelpRequest || config.additionalArgs.includes('--help')) {
    await runPassThroughCommand(binaryPath, ['detect', ...config.additionalArgs]);

    return false;
  }

  let finalLeaks: Leak[] = [];
  switch (config.diffMode) {
    case 'ci':
      finalLeaks = await runCiScan(binaryPath, config);
      break;
    case 'all':
      finalLeaks = await runAllUncommittedScan(binaryPath, config);
      break;
    case 'history':
      finalLeaks = await runHistoryScan(binaryPath, config);
      break;
    case 'staged':
    default:
      finalLeaks = await runStagedScan(binaryPath, config);
      break;
  }

  printConsoleSummary(finalLeaks, config);

  if (config.htmlReport || config.reportFormat) {
    generateReportFiles(finalLeaks, config);
  }

  return finalLeaks.length > 0;
}

export function runPassThroughCommand(binaryPath: string, args: string[]): Promise<number> {
  return new Promise(resolve => {
    const gitleaks = spawn(binaryPath, args, { stdio: 'inherit' });
    gitleaks.on('error', err => {
      logger.error(`Failed to start Gitleaks: ${err.message}`);
      resolve(1);
    });
    gitleaks.on('close', code => {
      resolve(code ?? 0);
    });
  });
}

async function runCiScan(binaryPath: string, config: ScanConfig): Promise<Leak[]> {
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;
  if (!headSha) {
    throw new Error(
      'For --diff-mode ci, the HEAD_SHA environment variable must be set, but it was not found.',
    );
  }
  if (!baseSha || baseSha === headSha) {
    logger.info(
      '✅ BASE_SHA not provided or is identical to HEAD_SHA. Concluding there are no changes to scan.',
    );

    return [];
  }
  logger.info(
    `Scanning final state of changed files between ${baseSha.slice(0, 7)} and ${headSha.slice(
      0,
      7,
    )}...`,
  );
  const changedFilesOutput = execFileSync(GIT, ['diff', '--name-only', `${baseSha}..${headSha}`])
    .toString()
    .trim();
  if (!changedFilesOutput) {
    logger.info('✅ No files changed in this PR to scan.');

    return [];
  }
  const changedFiles = changedFilesOutput.split('\n');
  logger.info(`Found ${changedFiles.length} changed file(s) to scan...`);
  const args = ['detect', '--no-git'];
  const filesToScan: string[] = [];
  for (const file of changedFiles) {
    if (fs.existsSync(file)) {
      args.push('--source', file);
      filesToScan.push(file);
    }
  }
  if (filesToScan.length === 0) {
    logger.info('✅ All changes were deletions, no files to scan.');

    return [];
  }
  const leaks = await executeGitleaks(binaryPath, args, config);
  if (leaks.length === 0) {
    return [];
  }

  logger.info(`Enriching ${leaks.length} finding(s) with author data...`);
  const enrichedLeaks: Leak[] = [];
  for (const leak of leaks) {
    try {
      const blameOutput = execFileSync(GIT, [
        'blame',
        '-L',
        `${leak.StartLine},${leak.StartLine}`,
        '--porcelain',
        headSha,
        '--',
        leak.File,
      ]).toString();
      const commitMatch = blameOutput.match(/^([a-f0-9]{40})/m);
      const authorMatch = blameOutput.match(/^author (.+)/m);
      const mailMatch = blameOutput.match(/^author-mail <(.+)>/m);
      const timeMatch = blameOutput.match(/^author-time ([0-9]+)/m);
      if (commitMatch?.[1]) leak.Commit = commitMatch[1];
      if (authorMatch?.[1]) leak.Author = authorMatch[1];
      if (mailMatch?.[1]) leak.Email = mailMatch[1];
      if (timeMatch?.[1]) leak.Date = new Date(parseInt(timeMatch[1], 10) * 1000).toISOString();
      enrichedLeaks.push(leak);
    } catch {
      logger.warn(`Could not run git blame on file ${leak.File}, some report data may be missing.`);
      enrichedLeaks.push(leak);
    }
  }

  return enrichedLeaks;
}

async function runAllUncommittedScan(binaryPath: string, config: ScanConfig): Promise<Leak[]> {
  logger.info('Scanning all uncommitted changes (staged, unstaged, and untracked)...');

  const stagedLeaks = await runStagedScan(binaryPath, config, true);

  let otherLeaks: Leak[] = [];

  const unstagedFiles = execFileSync(GIT, ['diff', '--name-only'])
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);

  const untrackedFiles = execFileSync(GIT, ['ls-files', '--others', '--exclude-standard'])
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);

  const filesToScan = [...new Set([...unstagedFiles, ...untrackedFiles])];

  if (filesToScan.length > 0) {
    let tempDir: string | undefined;
    try {
      logger.info(`Scanning ${filesToScan.length} unstaged/untracked file(s)...`);
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitleaks-uncommitted-'));
      for (const file of filesToScan) {
        const sourcePath = path.join(process.cwd(), file);
        if (fs.existsSync(sourcePath) && fs.lstatSync(sourcePath).isFile()) {
          const tempFilePath = path.join(tempDir, file);
          fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
          fs.copyFileSync(sourcePath, tempFilePath);
        }
      }

      if (fs.readdirSync(tempDir).length > 0) {
        const args = ['detect', '--source', tempDir, '--no-git'];
        const rawLeaks = await executeGitleaks(binaryPath, args, config);

        otherLeaks = rawLeaks.map(leak => {
          const originalPath = leak.File;
          const relativePath = path.relative(tempDir!, originalPath).replace(/\\/g, '/');
          leak.File = relativePath;
          leak.Fingerprint = leak.Fingerprint.replace(originalPath, relativePath);

          return leak;
        });
      }
    } finally {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const allLeaks = [...stagedLeaks];
  const stagedFingerprints = new Set(stagedLeaks.map(l => l.Fingerprint));
  for (const leak of otherLeaks) {
    if (!stagedFingerprints.has(leak.Fingerprint)) {
      allLeaks.push(leak);
    }
  }

  return allLeaks;
}

async function runStagedScan(
  binaryPath: string,
  config: ScanConfig,
  silent = false,
): Promise<Leak[]> {
  const stagedFiles = execFileSync(GIT, ['diff', '--cached', '--name-only']).toString().trim();
  if (!stagedFiles) {
    if (!silent) logger.info('✅ No staged changes to scan.');

    return [];
  }
  try {
    if (!silent) logger.info('Running Scan on staged changes...');
    const treeHash = execFileSync(GIT, ['write-tree']).toString().trim();
    const commitHash = execFileSync(GIT, ['commit-tree', treeHash, '-p', 'HEAD'], {
      input: 'gitleaks-secret-scanner virtual commit\n',
    })
      .toString()
      .trim();
    const args = ['detect', '--source', '.', '--log-opts', `HEAD..${commitHash}`];

    return await executeGitleaks(binaryPath, args, config);
  } catch (err) {
    throw new Error(`Staged scan failed: ${(err as Error).message}`);
  }
}

async function runHistoryScan(binaryPath: string, config: ScanConfig): Promise<Leak[]> {
  const args = ['detect', '--source', '.'];
  if (config.scanDepth && config.scanDepth > 0) {
    logger.info(`Scanning the last ${config.scanDepth} commit(s) of repository history...`);
    args.push('--log-opts', `--max-count=${config.scanDepth}`);
  } else {
    const commitCount = parseInt(
      execFileSync(GIT, ['rev-list', '--count', 'HEAD']).toString().trim(),
      10,
    );
    logger.info(`Scanning ${commitCount} total commits in repository history...`);
  }

  return executeGitleaks(binaryPath, args, config);
}

function executeGitleaks(binaryPath: string, args: string[], config: ScanConfig): Promise<Leak[]> {
  return new Promise((resolve, reject) => {
    const tempReportPath = path.join(os.tmpdir(), `gitleaks-report-${Date.now()}.json`);
    const finalArgs = [...args, '--report-format', 'json', '--report-path', tempReportPath];
    if (config.configPath) finalArgs.push('--config', config.configPath);
    if (config.additionalArgs) finalArgs.push(...config.additionalArgs);

    const gitleaks = spawn(binaryPath, finalArgs);
    let stderr = '';
    gitleaks.stderr.on('data', data => {
      stderr += data;
    });
    gitleaks.on('error', err => reject(new Error(`Gitleaks execution failed: ${err.message}`)));

    gitleaks.on('close', code => {
      try {
        if (code === 0 || code === 1) {
          const output = fs.existsSync(tempReportPath)
            ? fs.readFileSync(tempReportPath, 'utf8')
            : '[]';
          resolve(JSON.parse(output));
        } else {
          reject(new Error(`Gitleaks exited with unexpected code ${code}:\n${stderr}`));
        }
      } catch (err) {
        reject(err as Error);
      } finally {
        if (fs.existsSync(tempReportPath)) fs.unlinkSync(tempReportPath);
      }
    });
  });
}

function printConsoleSummary(leaks: Leak[], config: ScanConfig): void {
  if (!config.additionalArgs.includes('--no-banner')) {
    logger.print('\n    ○\n    │╲\n    │ ○\n    ○ ░\n    ░    gitleaks\n');
  }

  if (leaks.length > 0) {
    for (const leak of leaks) {
      const parts = [
        `Finding:     ${leak.Description}`,
        'Secret:      REDACTED',
        `RuleID:      ${leak.RuleID}`,
        `File:        ${leak.File}`,
        `Line:        ${leak.StartLine}`,
      ];
      if (leak.Commit) parts.push(`Commit:      ${leak.Commit}`);
      if (leak.Author) parts.push(`Author:      ${leak.Author}`);
      if (leak.Date) parts.push(`Date:        ${leak.Date}`);

      logger.print(parts.join('\n'));
      logger.print('----------------------------------------------------');
    }
    logger.print(`\nWRN leaks found: ${leaks.length}`);
  } else {
    logger.print('INF no leaks found');
  }
}

function generateReportFiles(leaks: Leak[], config: ScanConfig): void {
  function getDefaultReportPath(format: string): string {
    const ext =
      ({ json: 'json', csv: 'csv', sarif: 'sarif', junit: 'xml' } as Record<string, string>)[
        format
      ] || format;

    return `gitleaks-report.${ext}`;
  }
  if (config.htmlReport) {
    logger.print('\nGenerating HTML report...');
    const reportPath = config.htmlReport === true ? 'gitleaks-report.html' : config.htmlReport;
    generateHtmlReport(leaks, reportPath as string);
    logger.print(`✅ HTML report generated: ${reportPath}`);
  } else if (config.reportFormat) {
    logger.print(`\nGenerating ${config.reportFormat.toUpperCase()} report...`);
    const reportPath = config.reportPath || getDefaultReportPath(config.reportFormat);
    fs.writeFileSync(reportPath, JSON.stringify(leaks, null, 2));
    logger.print(`✅ ${config.reportFormat.toUpperCase()} report generated: ${reportPath}`);
  }
}
