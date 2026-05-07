import fs from 'node:fs';
import path from 'node:path';

import { ProxyAgent } from 'undici';

import { toError } from './spider';

const DEFAULT_VALIDATION_TARGET_URL = 'https://ncode.syosetu.com/';
const HTML_FETCH_RETRY_COUNT = 2;

export type NetworkProxyProtocol = 'http' | 'https';

export interface NetworkProxyConfigInput {
  enabled: boolean;
  protocol?: NetworkProxyProtocol;
  host?: string;
  port?: number | null;
  username?: string;
  password?: string;
  bypassHosts?: string[];
}

export interface NetworkProxyConfig {
  enabled: boolean;
  protocol: NetworkProxyProtocol;
  host: string;
  port: number | null;
  username: string;
  password: string;
  bypassHosts: string[];
  isConfigured: boolean;
  updatedAt: string | null;
}

export interface NetworkProxyValidationResult {
  ok: boolean;
  checkedAt: string;
  targetUrl: string;
  usingProxy: boolean;
  statusCode: number | null;
  latencyMs: number;
  message: string;
}

export interface NetworkProxyState {
  config: NetworkProxyConfig;
  validation: NetworkProxyValidationResult | null;
}

export interface ProxyAwareRequestInit extends RequestInit {
  dispatcher?: unknown;
}

export interface ProxyTextRequest {
  url: string;
  headers: Record<string, string>;
}

export type ProxyAwareFetch = (
  input: string,
  init?: ProxyAwareRequestInit,
) => Promise<Response>;

export interface NetworkProxyServiceOptions {
  initialConfig?: Partial<NetworkProxyConfigInput>;
  fetchImpl?: ProxyAwareFetch;
  storageFilePath?: string;
}

export interface ProxyAwareHtmlFetcherOptions {
  proxyService: NetworkProxyService;
  fetchImpl?: ProxyAwareFetch;
}

export class NetworkProxyService {
  readonly #fetchImpl: ProxyAwareFetch;
  readonly #storageFilePath: string | null;

  #config: NetworkProxyConfig;
  #lastValidation: NetworkProxyValidationResult | null = null;
  #proxyAgent: ProxyAgent | null = null;
  #proxyAgentUrl: string | null = null;

  constructor(options: NetworkProxyServiceOptions = {}) {
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#storageFilePath = options.storageFilePath ?? null;
    const persistedConfig = this.#storageFilePath
      ? loadPersistedConfig(this.#storageFilePath)
      : null;
    this.#config = normalizeConfig({
      enabled: false,
      protocol: 'http',
      host: '',
      port: null,
      username: '',
      password: '',
      bypassHosts: [],
      ...(persistedConfig?.config ?? {}),
      ...options.initialConfig,
    });
    this.#config = {
      ...this.#config,
      updatedAt: persistedConfig?.updatedAt ?? null,
    };
  }

  close(): void {
    this.disposeProxyAgent();
  }

  getState(): NetworkProxyState {
    return {
      config: this.getConfig(),
      validation: this.#lastValidation ? { ...this.#lastValidation } : null,
    };
  }

  getConfig(): NetworkProxyConfig {
    return cloneConfig(this.#config);
  }

  getLastValidation(): NetworkProxyValidationResult | null {
    return this.#lastValidation ? { ...this.#lastValidation } : null;
  }

  updateConfig(input: NetworkProxyConfigInput): NetworkProxyConfig {
    const nextConfig = normalizeConfig(input);

    if (nextConfig.enabled && !nextConfig.isConfigured) {
      throw new Error('Enabled proxy requires both host and port.');
    }

    this.#config = {
      ...nextConfig,
      updatedAt: new Date().toISOString(),
    };
    this.#lastValidation = null;
    this.disposeProxyAgent();
    persistConfig(this.#storageFilePath, this.#config);

    return this.getConfig();
  }

  resolveProxyUrl(targetUrl: string): string | null {
    const target = new URL(targetUrl);

    if (!this.#config.enabled || !this.#config.isConfigured) {
      return null;
    }

    if (shouldBypassHost(target.hostname, this.#config.bypassHosts)) {
      return null;
    }

    return buildProxyUrl(this.#config);
  }

  createRequestInit(targetUrl: string, init: ProxyAwareRequestInit = {}): ProxyAwareRequestInit {
    const proxyUrl = this.resolveProxyUrl(targetUrl);

    if (!proxyUrl) {
      return { ...init };
    }

    return {
      ...init,
      dispatcher: this.getProxyAgent(proxyUrl),
    };
  }

  async validate(targetUrl = DEFAULT_VALIDATION_TARGET_URL): Promise<NetworkProxyValidationResult> {
    const normalizedTargetUrl = normalizeTargetUrl(targetUrl);
    const startedAt = Date.now();
    const usingProxy = this.resolveProxyUrl(normalizedTargetUrl) !== null;

    try {
      const response = await this.#fetchImpl(
        normalizedTargetUrl,
        this.createRequestInit(normalizedTargetUrl, {
          method: 'GET',
          redirect: 'follow',
        }),
      );

      const result: NetworkProxyValidationResult = {
        ok: response.ok,
        checkedAt: new Date().toISOString(),
        targetUrl: normalizedTargetUrl,
        usingProxy,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
        message: response.ok
          ? `Validation request succeeded with status ${response.status}.`
          : `Validation request returned ${response.status} ${response.statusText}.`,
      };

      this.#lastValidation = result;
      return { ...result };
    } catch (error) {
      const result: NetworkProxyValidationResult = {
        ok: false,
        checkedAt: new Date().toISOString(),
        targetUrl: normalizedTargetUrl,
        usingProxy,
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        message: toError(error).message,
      };

      this.#lastValidation = result;
      return { ...result };
    }
  }

  private getProxyAgent(proxyUrl: string): ProxyAgent {
    if (this.#proxyAgent && this.#proxyAgentUrl === proxyUrl) {
      return this.#proxyAgent;
    }

    this.disposeProxyAgent();
    this.#proxyAgent = new ProxyAgent(proxyUrl);
    this.#proxyAgentUrl = proxyUrl;
    return this.#proxyAgent;
  }

  private disposeProxyAgent(): void {
    if (this.#proxyAgent) {
      void this.#proxyAgent.close();
    }

    this.#proxyAgent = null;
    this.#proxyAgentUrl = null;
  }
}

export function createProxyAwareHtmlFetcher(
  options: ProxyAwareHtmlFetcherOptions,
): (request: ProxyTextRequest) => Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (request) => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= HTML_FETCH_RETRY_COUNT; attempt += 1) {
      try {
        const response = await fetchImpl(
          request.url,
          options.proxyService.createRequestInit(request.url, {
            headers: request.headers,
            redirect: 'follow',
          }),
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch ${request.url}: ${response.status} ${response.statusText}`);
        }

        return response.text();
      } catch (error) {
        lastError = toError(error);

        if (attempt >= HTML_FETCH_RETRY_COUNT || !shouldRetryHtmlFetch(lastError)) {
          break;
        }
      }
    }

    throw new Error(formatHtmlFetchFailureMessage(request.url, lastError));
  };
}

function shouldRetryHtmlFetch(error: Error): boolean {
  const cause = readErrorCause(error);
  const code = typeof cause?.code === 'string' ? cause.code : undefined;

  return (
    error.message === 'fetch failed' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT'
  );
}

function formatHtmlFetchFailureMessage(url: string, error: Error | null): string {
  if (!error) {
    return `Failed to fetch ${url}.`;
  }

  const cause = readErrorCause(error);
  const causeCode = typeof cause?.code === 'string' ? `${cause.code}: ` : '';
  const causeMessage = typeof cause?.message === 'string' ? cause.message : '';

  if (causeMessage.length > 0) {
    return `Failed to fetch ${url}: ${causeCode}${causeMessage}`;
  }

  return error.message.startsWith('Failed to fetch ')
    ? error.message
    : `Failed to fetch ${url}: ${error.message}`;
}

function readErrorCause(error: Error): { code?: unknown; message?: unknown } | null {
  if (!('cause' in error)) {
    return null;
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') {
    return null;
  }

  return cause as { code?: unknown; message?: unknown };
}

function normalizeConfig(input: NetworkProxyConfigInput): NetworkProxyConfig {
  const protocol = input.protocol ?? 'http';
  const host = input.host?.trim() ?? '';
  const port = normalizePort(input.port);
  const username = input.username?.trim() ?? '';
  const password = input.password?.trim() ?? '';
  const bypassHosts = normalizeBypassHosts(input.bypassHosts ?? []);
  const isConfigured = host.length > 0 && port !== null;

  return {
    enabled: input.enabled,
    protocol,
    host,
    port,
    username,
    password,
    bypassHosts,
    isConfigured,
    updatedAt: null,
  };
}

function normalizePort(value: number | null | undefined): number | null {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Proxy port must be a positive integer.');
  }

  return value;
}

function normalizeBypassHosts(hosts: string[]): string[] {
  return [...new Set(hosts.map((host) => host.trim().toLowerCase()).filter((host) => host.length > 0))];
}

function shouldBypassHost(hostname: string, bypassHosts: string[]): boolean {
  const normalizedHost = hostname.trim().toLowerCase();
  return bypassHosts.some(
    (host) => normalizedHost === host || normalizedHost.endsWith(`.${host}`),
  );
}

function buildProxyUrl(config: NetworkProxyConfig): string {
  if (!config.isConfigured || config.port === null) {
    throw new Error('Proxy host and port are required.');
  }

  const credentials =
    config.username.length > 0
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
      : '';

  return `${config.protocol}://${credentials}${config.host}:${config.port}`;
}

function normalizeTargetUrl(targetUrl: string): string {
  return new URL(targetUrl).toString();
}

function cloneConfig(config: NetworkProxyConfig): NetworkProxyConfig {
  return {
    ...config,
    bypassHosts: [...config.bypassHosts],
  };
}

interface PersistedNetworkProxyConfig {
  config: NetworkProxyConfigInput;
  updatedAt: string | null;
}

function loadPersistedConfig(storageFilePath: string): PersistedNetworkProxyConfig | null {
  try {
    if (!fs.existsSync(storageFilePath)) {
      return null;
    }

    const fileContent = fs.readFileSync(storageFilePath, 'utf8');
    const parsed = JSON.parse(fileContent) as {
      config?: Partial<NetworkProxyConfigInput>;
      updatedAt?: unknown;
    };

    if (!parsed.config || typeof parsed.config !== 'object') {
      return null;
    }

    return {
      config: {
        enabled: typeof parsed.config.enabled === 'boolean' ? parsed.config.enabled : false,
        protocol: parsed.config.protocol === 'https' ? 'https' : 'http',
        host: typeof parsed.config.host === 'string' ? parsed.config.host : '',
        port: typeof parsed.config.port === 'number' ? parsed.config.port : null,
        username: typeof parsed.config.username === 'string' ? parsed.config.username : '',
        password: typeof parsed.config.password === 'string' ? parsed.config.password : '',
        bypassHosts: Array.isArray(parsed.config.bypassHosts)
          ? parsed.config.bypassHosts.filter((host): host is string => typeof host === 'string')
          : [],
      },
      updatedAt: typeof parsed.updatedAt === 'string' || parsed.updatedAt === null
        ? parsed.updatedAt
        : null,
    };
  } catch {
    return null;
  }
}

function persistConfig(storageFilePath: string | null, config: NetworkProxyConfig): void {
  if (!storageFilePath) {
    return;
  }

  fs.mkdirSync(path.dirname(storageFilePath), { recursive: true });
  fs.writeFileSync(
    storageFilePath,
    JSON.stringify(
      {
        config: {
          enabled: config.enabled,
          protocol: config.protocol,
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          bypassHosts: config.bypassHosts,
        },
        updatedAt: config.updatedAt,
      },
      null,
      2,
    ),
    'utf8',
  );
}