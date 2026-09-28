/** Destination for log lines; see {@link Logger.setSink}. */
export interface LogSink {
  out(chunk: string): void;
  err(chunk: string): void;
}

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** How a line is rendered. */
export type LogFormat = 'pretty' | 'ci' | 'json';

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  color?: 'auto' | 'always' | 'never';
  timestamps?: boolean;
  /** Levels routed to stderr rather than stdout. */
  stderrLevels?: LogLevel[];
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  log: 2,
  debug: 3,
};

const COLORS: Record<LogLevel, string> = {
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  info: '\x1b[32m', // green
  log: '\x1b[37m', // white
  debug: '\x1b[36m', // cyan
};

const RESET = '\x1b[0m';

/**
 * Whether ANSI colour is wanted on `stream`.
 *
 * Colour used to be emitted unconditionally, so a piped or redirected run — and
 * every CI log — was littered with escape sequences. `NO_COLOR` is the de-facto
 * standard (no-color.org) and `FORCE_COLOR` the usual override; both are honoured
 * here, and the TTY test asks about the stream actually being written to.
 */
function wantsColor(mode: 'auto' | 'always' | 'never', stream: NodeJS.WriteStream): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  if (process.env.FORCE_COLOR) return process.env.FORCE_COLOR !== '0';
  if (process.env.NO_COLOR !== undefined) return false;

  return Boolean(stream.isTTY);
}

export class Logger {
  private currentLevel: LogLevel = 'info';
  private format: LogFormat;
  private color: 'auto' | 'always' | 'never' = 'auto';
  private timestamps: boolean;
  private stderrLevels: Set<LogLevel> = new Set<LogLevel>(['error', 'warn']);

  constructor(options: LoggerOptions = {}) {
    // CI logs are read long after the fact and benefit from timestamps; a
    // terminal is read as it scrolls, where they are noise that also breaks the
    // alignment of the summary box.
    const inCi = Boolean(process.env.CI);
    this.format = options.format ?? (inCi ? 'ci' : 'pretty');
    this.timestamps = options.timestamps ?? this.format === 'ci';
    this.configure(options);
  }

  /** Apply options; unset fields keep their current value. */
  public configure(options: LoggerOptions): void {
    if (options.level) this.currentLevel = options.level;
    if (options.format) {
      this.format = options.format;
      if (options.timestamps === undefined) this.timestamps = options.format === 'ci';
    }
    if (options.color) this.color = options.color;
    if (options.timestamps !== undefined) this.timestamps = options.timestamps;
    if (options.stderrLevels) this.stderrLevels = new Set(options.stderrLevels);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] <= LEVEL_ORDER[this.currentLevel];
  }

  private streamFor(level: LogLevel): NodeJS.WriteStream {
    return this.stderrLevels.has(level) ? process.stderr : process.stdout;
  }

  /**
   * Where lines actually go. Swappable so tests can capture output without
   * touching `process.stdout`.
   *
   * That distinction is not stylistic. Node's test runner reports each file's
   * results to the parent process over stdout, so a test that replaces
   * `process.stdout.write` and swallows what it receives also swallows those
   * frames: the parent then waits forever for a file that already finished. It
   * only shows up under load — on a two-core CI runner the frames land inside
   * the capture window, on a developer's machine they usually do not — which
   * made it a three-hour hang that never reproduced locally.
   */
  private sink: LogSink | null = null;

  /**
   * Redirect output, returning the previous sink so the caller can restore it.
   * Passing `null` restores the real streams.
   */
  public setSink(sink: LogSink | null): LogSink | null {
    const previous = this.sink;
    this.sink = sink;

    return previous;
  }

  private emit(stream: NodeJS.WriteStream, text: string): void {
    if (!this.sink) {
      stream.write(text);

      return;
    }
    if (stream === process.stderr) this.sink.err(text);
    else this.sink.out(text);
  }

  private render(level: LogLevel, message: string, error?: unknown): string {
    const stack = error instanceof Error ? `\n${error.stack}` : '';

    if (this.format === 'json') {
      return JSON.stringify({
        level,
        message,
        ...(stack ? { stack: stack.trim() } : {}),
        time: new Date().toISOString(),
      });
    }

    const time = this.timestamps ? `[${new Date().toISOString()}] ` : '';
    const tag = this.format === 'ci' ? `[${level.toUpperCase()}] ` : '';

    return `${time}${tag}${message}${stack}`;
  }

  private logMessage(level: LogLevel, message: string, error?: unknown): void {
    if (!this.shouldLog(level)) return;

    const stream = this.streamFor(level);
    const line = this.render(level, message, error);
    // JSON output is meant to be parsed; coloring it would corrupt the payload.
    const colored =
      this.format !== 'json' && wantsColor(this.color, stream)
        ? `${COLORS[level]}${line}${RESET}`
        : line;

    this.emit(stream, `${colored}\n`);
  }

  public log(msg: string): void {
    this.logMessage('log', msg);
  }

  public info(msg: string): void {
    this.logMessage('info', msg);
  }

  public warn(msg: string): void {
    this.logMessage('warn', msg);
  }

  public error(msg: string, err?: unknown): void {
    this.logMessage('error', msg, err);
  }

  public debug(msg: string): void {
    this.logMessage('debug', msg);
  }

  /**
   * Product output: the run summary, printed verbatim.
   *
   * Distinct from `info` because the summary is the thing the run exists to
   * produce, not a note about producing it. Routing it through the log formatter
   * prefixed every line with a timestamp and a level, which pushed the box
   * borders out of alignment and made the headline artefact look broken.
   */
  public print(msg: string): void {
    this.emit(process.stdout, `${msg}\n`);
  }

  public setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }
}

export const logger = new Logger();
