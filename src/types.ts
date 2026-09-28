export type DiffMode = 'staged' | 'all' | 'ci' | 'history';

export interface ScanConfig {
  version: string | null;
  configPath: string | null;
  htmlReport: string | boolean | null;
  reportFormat: string | null;
  reportPath: string | null;
  diffMode: DiffMode;
  scanDepth: number | null;
  additionalArgs: string[];
  isHelpRequest?: boolean;
}

export interface Leak {
  File: string;
  StartLine: number;
  RuleID: string;
  Description: string;
  Fingerprint: string;
  Author?: string;
  Email?: string;
  Commit?: string;
  Date?: string;
}

export interface PackageInfo {
  name: string;
  version: string;
  repository?: { url?: string };
}

export interface AvailableVersion {
  version: string;
  name: string;
  published: string;
  url: string;
}
