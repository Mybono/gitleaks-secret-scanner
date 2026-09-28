import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';

const PACKAGE_JSON = 'package.json';

/** Check if husky is already installed in the project. */
export function isHuskyInstalled(): boolean {
  try {
    const projectRoot = process.cwd();
    const packageJsonPath = path.join(projectRoot, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return false;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const hasDep = Boolean(packageJson.dependencies?.husky);
    const hasDevDep = Boolean(packageJson.devDependencies?.husky);

    return hasDep || hasDevDep;
  } catch {
    return false;
  }
}

/** Install husky in the user's project. */
export async function installHusky(): Promise<void> {
  logger.print('📦 Installing husky...\n');

  try {
    execSync('npm --version', { stdio: 'pipe' });

    logger.print('Running: npm install husky --save-dev');
    execSync('npm install husky --save-dev', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    logger.print('\n✅ Husky installed successfully.');
  } catch (error) {
    throw new Error(`Failed to install husky: ${(error as Error).message}`);
  }
}

/** Initialize husky in the project. */
export async function initializeHusky(): Promise<void> {
  const huskyDir = path.join(process.cwd(), '.husky');

  if (fs.existsSync(huskyDir)) {
    logger.print('✅ Husky directory already exists.\n');

    return;
  }

  logger.print('🔧 Initializing husky...\n');

  try {
    await fs.ensureDir(huskyDir);

    const huskyScriptDir = path.join(huskyDir, '_');
    await fs.ensureDir(huskyScriptDir);

    const huskyScript = `#!/usr/bin/env sh
if [ -z "$husky_skip_init" ]; then
  debug () {
    if [ "$HUSKY_DEBUG" = "1" ]; then
      echo "husky (debug) - $1"
    fi
  }

  readonly hook_name="$(basename -- "$0")"
  debug "starting $hook_name..."

  if [ "$HUSKY" = "0" ]; then
    debug "HUSKY env variable is set to 0, skipping hook"
    exit 0
  fi

  if [ -f ~/.huskyrc ]; then
    debug "sourcing ~/.huskyrc"
    . ~/.huskyrc
  fi

  readonly husky_skip_init=1
  export husky_skip_init
  sh -e "$0" "$@"
  exitCode="$?"

  if [ $exitCode != 0 ]; then
    echo "husky - $hook_name hook exited with code $exitCode (error)"
  fi

  if [ $exitCode = 127 ]; then
    echo "husky - command not found in PATH=$PATH"
  fi

  exit $exitCode
fi
`;

    await fs.writeFile(path.join(huskyScriptDir, 'husky.sh'), huskyScript, {
      mode: 0o755,
    });

    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

      if (!packageJson.scripts) {
        packageJson.scripts = {};
      }

      if (!packageJson.scripts.prepare || !packageJson.scripts.prepare.includes('husky')) {
        packageJson.scripts.prepare = packageJson.scripts.prepare
          ? `${packageJson.scripts.prepare} && husky`
          : 'husky';

        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        logger.print('✅ Added husky to package.json prepare script.');
      }
    }

    logger.print('✅ Husky initialized successfully.\n');
  } catch (error) {
    logger.warn(`⚠️ Could not initialize husky: ${(error as Error).message}`);
    logger.print('ℹ️ Continuing with pre-commit hook setup...\n');
  }
}

/** Create or update the pre-commit hook file. */
export async function setupPreCommitHook(
  command: string = 'npx gitleaks-secret-scanner',
): Promise<void> {
  const projectRoot = process.cwd();
  const huskyDir = path.join(projectRoot, '.husky');
  const preCommitPath = path.join(huskyDir, 'pre-commit');

  if (!fs.existsSync(huskyDir)) {
    await fs.mkdir(huskyDir, { recursive: true });
  }

  let preCommitContent = '';
  const gitleaksSection = `\n# Gitleaks secret scanning\n${command}\n`;

  if (fs.existsSync(preCommitPath)) {
    logger.print('ℹ️ Pre-commit hook already exists. Checking...\n');
    preCommitContent = await fs.readFile(preCommitPath, 'utf8');

    const hasNpxCommand = /^\s*npx\s+gitleaks-secret-scanner/m.test(preCommitContent);
    const hasDirectCommand = /^\s*gitleaks-secret-scanner/m.test(preCommitContent);

    if (hasNpxCommand || hasDirectCommand) {
      logger.print('✅ Gitleaks scan is already configured in pre-commit hook.');
      logger.print(`   Hook location: ${preCommitPath}\n`);

      return;
    }

    logger.print('📝 Appending Gitleaks to existing pre-commit hook...\n');

    if (!preCommitContent.endsWith('\n')) {
      preCommitContent += '\n';
    }

    preCommitContent += gitleaksSection;
  } else {
    logger.print('📝 Creating new pre-commit hook...\n');
    preCommitContent = `#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
${gitleaksSection}`;
  }

  await fs.writeFile(preCommitPath, preCommitContent, { mode: 0o755 });

  try {
    await fs.chmod(preCommitPath, 0o755);
  } catch {
    logger.warn('⚠️ Could not set executable permissions on pre-commit hook');
  }

  logger.print('✅ Pre-commit hook configured successfully.');
  logger.print(`   Hook location: ${preCommitPath}\n`);
}

function printManualInstructions(command: string): void {
  logger.print('\n📖 Manual Setup Instructions:\n');
  logger.print('If automatic setup failed, you can set up the pre-commit hook manually:\n');
  logger.print('1. Install Husky (if not already installed):');
  logger.print('   npm install husky --save-dev\n');
  logger.print('2. Initialize Husky:');
  logger.print('   npx husky init\n');
  logger.print('3. Create or update .husky/pre-commit file with:');
  logger.print('   #!/usr/bin/env sh');
  logger.print('   . "$(dirname -- "$0")/_/husky.sh"\n');
  logger.print('   # Gitleaks secret scanning');
  logger.print(`   ${command}\n`);
  logger.print('4. Make the file executable:');
  logger.print('   chmod +x .husky/pre-commit\n');
}

export interface SetupHuskyOptions {
  command?: string;
}

/** Setup husky with gitleaks in the user's project. */
export async function setupHusky(options: SetupHuskyOptions = {}): Promise<void> {
  const { command = 'npx gitleaks-secret-scanner' } = options;

  logger.print('🚀 Setting up Husky with Gitleaks...\n');

  try {
    if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
      logger.error('❌ Not in a git repository.');
      logger.print('ℹ️  Please run this command from the root of your git project.\n');
      printManualInstructions(command);
      process.exit(1);
    }

    if (!fs.existsSync(path.join(process.cwd(), 'package.json'))) {
      logger.error('❌ No package.json found.');
      logger.print('ℹ️  Please run this command from the root of your npm project.\n');
      printManualInstructions(command);
      process.exit(1);
    }

    if (!isHuskyInstalled()) {
      try {
        await installHusky();
      } catch (huskyError) {
        logger.error(`⚠️  Husky installation failed: ${(huskyError as Error).message}`);
        logger.print('ℹ️  Continuing with manual setup instructions...\n');
        printManualInstructions(command);
        process.exit(1);
      }
    } else {
      logger.print('✅ Husky is already installed.\n');
    }

    try {
      await initializeHusky();
    } catch (initError) {
      logger.warn(`⚠️  Husky initialization encountered an issue: ${(initError as Error).message}`);
      logger.print('ℹ️  Attempting to continue with hook setup...\n');
    }

    try {
      await setupPreCommitHook(command);
      logger.print('\n✨ Setup complete! Gitleaks will now run on every commit.');
      logger.print('   You can test it by making a commit.\n');
    } catch (hookError) {
      logger.error(`⚠️  Pre-commit hook setup failed: ${(hookError as Error).message}`);
      logger.print('ℹ️  Please set up the hook manually:\n');
      printManualInstructions(command);
      process.exit(1);
    }
  } catch (error) {
    logger.error(`\n❌ Unexpected error: ${(error as Error).message}\n`);
    printManualInstructions(command);
    process.exit(1);
  }
}
