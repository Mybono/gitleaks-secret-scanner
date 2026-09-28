declare module 'unzipper' {
  import type { Writable } from 'stream';

  export function Extract(options: { path: string }): Writable;
}
