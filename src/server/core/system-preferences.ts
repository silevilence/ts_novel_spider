import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { embed, generateText } from 'ai';
import { rerank } from 'ai';
import { createOllama } from 'ai-sdk-ollama';
import neo4j from 'neo4j-driver';

import { toError } from './spider';

export type ModelCapability = 'chat' | 'embedding' | 'rerank';
export type ModelCapabilityMode = 'manual' | 'auto';
export type LlmProviderType = 'openai-compatible' | 'anthropic' | 'google-generative-ai' | 'ollama';

export interface LlmModelConfigInput {
  id?: string;
  label?: string;
  modelId?: string;
  enabled?: boolean;
  capabilityMode?: ModelCapabilityMode;
  capabilities?: ModelCapability[];
  defaultFor?: ModelCapability[];
}

export interface LlmProviderConfigInput {
  id?: string;
  label?: string;
  type?: LlmProviderType;
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  organization?: string;
  models?: LlmModelConfigInput[];
}

interface StoredLlmModelConfig {
  id: string;
  label: string;
  modelId: string;
  enabled: boolean;
  capabilityMode: ModelCapabilityMode;
  capabilities: ModelCapability[];
  defaultFor: ModelCapability[];
}

interface StoredLlmProviderConfig {
  id: string;
  label: string;
  type: LlmProviderType;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  organization: string;
  models: StoredLlmModelConfig[];
}

export interface LlmModelConfig extends StoredLlmModelConfig {
  resolvedCapabilities: ModelCapability[];
  lastValidatedAt: string | null;
  isConfigured: boolean;
}

export interface LlmProviderConfig extends Omit<StoredLlmProviderConfig, 'models'> {
  models: LlmModelConfig[];
  isConfigured: boolean;
}

export interface LlmModelValidationResult {
  providerId: string;
  modelId: string;
  ok: boolean;
  checkedAt: string;
  statusCode: number | null;
  latencyMs: number;
  message: string;
  detectedCapabilities: ModelCapability[];
}

export interface LlmPreferencesState {
  providers: LlmProviderConfig[];
  validations: LlmModelValidationResult[];
  updatedAt: string | null;
}

export interface LlmDiscoveredModel {
  modelId: string;
  label: string;
  description: string | null;
  detectedCapabilities: ModelCapability[];
}

export interface Neo4jConfigInput {
  enabled: boolean;
  uri?: string;
  username?: string;
  password?: string;
  database?: string;
}

export interface Neo4jConfig {
  enabled: boolean;
  uri: string;
  username: string;
  password: string;
  database: string;
  isConfigured: boolean;
  updatedAt: string | null;
}

export interface Neo4jValidationResult {
  ok: boolean;
  checkedAt: string;
  latencyMs: number;
  database: string | null;
  serverAgent: string | null;
  message: string;
}

export interface Neo4jPreferencesState {
  config: Neo4jConfig;
  validation: Neo4jValidationResult | null;
}

// ── 阅读器排版偏好 ──

export type ReaderFontFamilyPreset = 'sans' | 'serif' | 'monospace' | 'custom';

export interface ReaderTypographyConfigInput {
  fontSize?: number;
  fontSizePreset?: 'small' | 'medium' | 'large';
  lineHeight?: number;
  paragraphSpacing?: number;
  fontFamilyPreset?: ReaderFontFamilyPreset;
  fontFamilyCustom?: string;
}

export interface ReaderTypographyConfig {
  fontSize: number;
  fontSizePreset: 'small' | 'medium' | 'large';
  lineHeight: number;
  paragraphSpacing: number;
  fontFamilyPreset: ReaderFontFamilyPreset;
  fontFamilyCustom: string;
}

export interface ReaderTypographyState {
  config: ReaderTypographyConfig;
  updatedAt: string | null;
}

/** 阅读器排版生效配置，含来源标记 */
export interface ReaderTypographyResolved {
  fontSize: number;
  fontSizePreset: 'small' | 'medium' | 'large';
  lineHeight: number;
  paragraphSpacing: number;
  fontFamilyPreset: ReaderFontFamilyPreset;
  fontFamilyCustom: string;
  source: 'global' | 'novel';
}

export const READER_TYPOGRAPHY_FONT_SIZE_PRESETS: Record<ReaderTypographyConfig['fontSizePreset'], number> = {
  small: 0.95,
  medium: 1.03,
  large: 1.16,
};

export const READER_TYPOGRAPHY_FONT_SIZE_MIN = 0.7;
export const READER_TYPOGRAPHY_FONT_SIZE_MAX = 2.2;
export const READER_TYPOGRAPHY_LINE_HEIGHT_MIN = 1.2;
export const READER_TYPOGRAPHY_LINE_HEIGHT_MAX = 3.0;
export const READER_TYPOGRAPHY_PARAGRAPH_SPACING_MIN = 0;
export const READER_TYPOGRAPHY_PARAGRAPH_SPACING_MAX = 3.5;

export const READER_TYPOGRAPHY_DEFAULTS: ReaderTypographyConfig = {
  fontSize: READER_TYPOGRAPHY_FONT_SIZE_PRESETS.medium,
  fontSizePreset: 'medium',
  lineHeight: 1.9,
  paragraphSpacing: 1,
  fontFamilyPreset: 'sans',
  fontFamilyCustom: '',
};

export function resolveFontFamily(config: ReaderTypographyConfig): string {
  switch (config.fontFamilyPreset) {
    case 'serif':
      return '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", Georgia, serif';
    case 'monospace':
      return '"Noto Sans Mono CJK SC", "Source Han Mono SC", "Courier New", monospace';
    case 'custom':
      return config.fontFamilyCustom || READER_TYPOGRAPHY_DEFAULTS.fontFamilyCustom || resolveFontFamily({ ...config, fontFamilyPreset: 'sans', fontFamilyCustom: '' });
    case 'sans':
    default:
      return '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  }
}

export function resolveEffectiveReaderTypography(
  global: ReaderTypographyConfig,
  override: ReaderTypographyConfig | null,
): ReaderTypographyResolved {
  const config = override ?? global;
  return {
    fontSize: clampFontSize(config.fontSize),
    fontSizePreset: config.fontSizePreset,
    lineHeight: clampLineHeight(config.lineHeight),
    paragraphSpacing: clampParagraphSpacing(config.paragraphSpacing),
    fontFamilyPreset: config.fontFamilyPreset,
    fontFamilyCustom: config.fontFamilyCustom,
    source: override ? 'novel' : 'global',
  };
}

// ── 翻译全局偏好 ──

export type TranslationLanguageCode = string;
export type TranslationExportMode = 'original' | 'translated' | 'bilingual';
export type TranslationLanguagePreset = 'ja→zh-CN';

export interface TranslationDefaultModelRouteInput {
  providerId?: string;
  modelId?: string;
}

export interface TranslationPreferencesInput {
  sourceLang?: TranslationLanguageCode;
  targetLang?: TranslationLanguageCode;
  termExtractionModel?: TranslationDefaultModelRouteInput | null;
  translationModels?: TranslationDefaultModelRouteInput[];
  reviewModel?: TranslationDefaultModelRouteInput | null;
  translationConcurrency?: number;
  qualityThreshold?: number;
  autoRejectUntranslatedTerms?: boolean;
  defaultExportMode?: TranslationExportMode;
}

export interface TranslationPreferencesConfig {
  sourceLang: TranslationLanguageCode;
  targetLang: TranslationLanguageCode;
  termExtractionModel: TranslationDefaultModelRouteInput | null;
  translationModels: TranslationDefaultModelRouteInput[];
  reviewModel: TranslationDefaultModelRouteInput | null;
  translationConcurrency: number;
  qualityThreshold: number;
  autoRejectUntranslatedTerms: boolean;
  defaultExportMode: TranslationExportMode;
}

export interface TranslationPreferencesState {
  config: TranslationPreferencesConfig;
  updatedAt: string | null;
}

export const TRANSLATION_LANGUAGE_PRESETS: Record<TranslationLanguagePreset, { sourceLang: TranslationLanguageCode; targetLang: TranslationLanguageCode }> = {
  'ja→zh-CN': { sourceLang: 'ja', targetLang: 'zh-CN' },
};

export const TRANSLATION_DEFAULTS: TranslationPreferencesConfig = {
  sourceLang: 'ja',
  targetLang: 'zh-CN',
  termExtractionModel: null,
  translationModels: [],
  reviewModel: null,
  translationConcurrency: 2,
  qualityThreshold: 0.8,
  autoRejectUntranslatedTerms: true,
  defaultExportMode: 'original',
};

export function normalizeTranslationPreferencesInput(input: TranslationPreferencesInput): TranslationPreferencesConfig {
  const termExtractionModel = input.termExtractionModel === null
    ? null
    : (typeof input.termExtractionModel === 'object' && input.termExtractionModel !== null
      ? buildModelRouteFromInput(input.termExtractionModel as Record<string, unknown>)
      : TRANSLATION_DEFAULTS.termExtractionModel);

  const reviewModel = input.reviewModel === null
    ? null
    : (typeof input.reviewModel === 'object' && input.reviewModel !== null
      ? buildModelRouteFromInput(input.reviewModel as Record<string, unknown>)
      : TRANSLATION_DEFAULTS.reviewModel);

  return {
    sourceLang: typeof input.sourceLang === 'string' ? input.sourceLang.trim() || TRANSLATION_DEFAULTS.sourceLang : TRANSLATION_DEFAULTS.sourceLang,
    targetLang: typeof input.targetLang === 'string' ? input.targetLang.trim() || TRANSLATION_DEFAULTS.targetLang : TRANSLATION_DEFAULTS.targetLang,
    termExtractionModel,
    translationModels: Array.isArray(input.translationModels)
      ? input.translationModels.filter((m): m is TranslationDefaultModelRouteInput => typeof m === 'object' && m !== null)
      : [],
    reviewModel,
    translationConcurrency: typeof input.translationConcurrency === 'number' && Number.isFinite(input.translationConcurrency)
      ? Math.max(1, Math.trunc(input.translationConcurrency))
      : TRANSLATION_DEFAULTS.translationConcurrency,
    qualityThreshold: typeof input.qualityThreshold === 'number' && Number.isFinite(input.qualityThreshold)
      ? Math.max(0, Math.min(1, input.qualityThreshold))
      : TRANSLATION_DEFAULTS.qualityThreshold,
    autoRejectUntranslatedTerms: typeof input.autoRejectUntranslatedTerms === 'boolean'
      ? input.autoRejectUntranslatedTerms
      : TRANSLATION_DEFAULTS.autoRejectUntranslatedTerms,
    defaultExportMode: input.defaultExportMode === 'original' || input.defaultExportMode === 'translated' || input.defaultExportMode === 'bilingual'
      ? input.defaultExportMode
      : TRANSLATION_DEFAULTS.defaultExportMode,
  };
}

function buildModelRouteFromInput(raw: Record<string, unknown>): TranslationDefaultModelRouteInput {
  const result: TranslationDefaultModelRouteInput = {};
  if (typeof raw.providerId === 'string') {
    result.providerId = raw.providerId;
  }
  if (typeof raw.modelId === 'string') {
    result.modelId = raw.modelId;
  }
  return result;
}

export function normalizeReaderTypographyInput(input: ReaderTypographyConfigInput): ReaderTypographyConfig {
  return {
    fontSize: typeof input.fontSize === 'number' ? clampFontSize(input.fontSize) : READER_TYPOGRAPHY_DEFAULTS.fontSize,
    fontSizePreset: isFontSizePreset(input.fontSizePreset) ? input.fontSizePreset : READER_TYPOGRAPHY_DEFAULTS.fontSizePreset,
    lineHeight: typeof input.lineHeight === 'number' ? clampLineHeight(input.lineHeight) : READER_TYPOGRAPHY_DEFAULTS.lineHeight,
    paragraphSpacing: typeof input.paragraphSpacing === 'number' ? clampParagraphSpacing(input.paragraphSpacing) : READER_TYPOGRAPHY_DEFAULTS.paragraphSpacing,
    fontFamilyPreset: isFontFamilyPreset(input.fontFamilyPreset) ? input.fontFamilyPreset : READER_TYPOGRAPHY_DEFAULTS.fontFamilyPreset,
    fontFamilyCustom: typeof input.fontFamilyCustom === 'string' ? input.fontFamilyCustom.trim() : '',
  };
}

function clampFontSize(value: number): number {
  return Math.max(READER_TYPOGRAPHY_FONT_SIZE_MIN, Math.min(READER_TYPOGRAPHY_FONT_SIZE_MAX, value));
}

function clampLineHeight(value: number): number {
  return Math.max(READER_TYPOGRAPHY_LINE_HEIGHT_MIN, Math.min(READER_TYPOGRAPHY_LINE_HEIGHT_MAX, value));
}

function clampParagraphSpacing(value: number): number {
  return Math.max(READER_TYPOGRAPHY_PARAGRAPH_SPACING_MIN, Math.min(READER_TYPOGRAPHY_PARAGRAPH_SPACING_MAX, value));
}

function isFontSizePreset(value: unknown): value is ReaderTypographyConfig['fontSizePreset'] {
  return value === 'small' || value === 'medium' || value === 'large';
}

function isFontFamilyPreset(value: unknown): value is ReaderFontFamilyPreset {
  return value === 'sans' || value === 'serif' || value === 'monospace' || value === 'custom';
}

// ──

export interface SystemPreferencesServiceOptions {
  fetchImpl?: typeof fetch;
  storageFilePath?: string;
  validateNeo4jImpl?: (config: Neo4jConfig) => Promise<Pick<Neo4jValidationResult, 'database' | 'message' | 'serverAgent'>>;
}

interface PersistedSystemPreferences {
  llmProviders: LlmProviderConfigInput[];
  neo4j: Neo4jConfigInput & { updatedAt?: string | null };
  readerTypography?: ReaderTypographyConfigInput;
  translation?: TranslationPreferencesInput;
  updatedAt: string | null;
}

const CAPABILITY_ORDER: ModelCapability[] = ['chat', 'embedding', 'rerank'];

export class SystemPreferencesService {
  readonly #fetchImpl: typeof fetch;
  readonly #storageFilePath: string | null;
  readonly #validateNeo4jImpl: (config: Neo4jConfig) => Promise<Pick<Neo4jValidationResult, 'database' | 'message' | 'serverAgent'>>;

  #llmProviders: StoredLlmProviderConfig[];
  #llmValidations = new Map<string, LlmModelValidationResult>();
  #neo4jConfig: Neo4jConfig;
  #neo4jValidation: Neo4jValidationResult | null = null;
  #readerTypography: ReaderTypographyConfig;
  #readerTypographyUpdatedAt: string | null = null;
  #translation: TranslationPreferencesConfig;
  #translationUpdatedAt: string | null = null;
  #updatedAt: string | null;

  constructor(options: SystemPreferencesServiceOptions = {}) {
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#storageFilePath = options.storageFilePath ?? null;
    this.#validateNeo4jImpl = options.validateNeo4jImpl ?? defaultNeo4jValidator;

    const persisted = this.#storageFilePath ? loadPersistedPreferences(this.#storageFilePath) : null;
    this.#llmProviders = normalizeProviderInputs(persisted?.llmProviders ?? []);
    this.#neo4jConfig = normalizeNeo4jConfig(persisted?.neo4j ?? { enabled: false });
    this.#neo4jConfig = {
      ...this.#neo4jConfig,
      updatedAt: persisted?.neo4j.updatedAt ?? null,
    };
    this.#readerTypography = normalizeReaderTypographyInput(persisted?.readerTypography ?? {});
    this.#readerTypographyUpdatedAt = persisted?.readerTypography ? (persisted.updatedAt ?? null) : null;
    this.#translation = normalizeTranslationPreferencesInput(persisted?.translation ?? {});
    this.#translationUpdatedAt = persisted?.translation ? (persisted.updatedAt ?? null) : null;
    this.#updatedAt = persisted?.updatedAt ?? null;
  }

  getLlmState(): LlmPreferencesState {
    return {
      providers: this.#llmProviders.map((provider) => serializeProvider(provider, this.#llmValidations)),
      validations: [...this.#llmValidations.values()].sort((left, right) =>
        right.checkedAt.localeCompare(left.checkedAt),
      ),
      updatedAt: this.#updatedAt,
    };
  }

  updateLlmProviders(inputs: LlmProviderConfigInput[]): LlmPreferencesState {
    this.#llmProviders = normalizeProviderInputs(inputs);
    this.#llmValidations = filterValidations(this.#llmValidations, this.#llmProviders);
    this.touch();
    persistPreferences(this.#storageFilePath, this.#llmProviders, this.#neo4jConfig, this.#updatedAt, this.#readerTypography, this.#translation);
    return this.getLlmState();
  }

  async discoverLlmProviderModels(input: LlmProviderConfigInput): Promise<LlmDiscoveredModel[]> {
    const provider = normalizeProviderInputs([{ ...input, models: [] }])[0];

    if (!provider) {
      return [];
    }

    if (!provider.enabled) {
      throw new Error('Please enable the provider before loading available models.');
    }

    if (!isProviderConfigured(provider)) {
      throw new Error(buildProviderValidationRequirementMessage(provider.type));
    }

    return discoverProviderModels({
      provider,
      fetchImpl: this.#fetchImpl,
    });
  }

  async validateLlmModel(providerId: string, modelId: string): Promise<LlmPreferencesState> {
    const provider = this.#llmProviders.find((entry) => entry.id === providerId);

    if (!provider) {
      throw new Error(`Provider ${providerId} was not found.`);
    }

    const model = provider.models.find((entry) => entry.id === modelId);
    if (!model) {
      throw new Error(`Model ${modelId} was not found.`);
    }

    if (!provider.enabled) {
      throw new Error('Please enable the provider before running connectivity checks.');
    }

    if (!isProviderConfigured(provider)) {
      throw new Error(buildProviderValidationRequirementMessage(provider.type));
    }

    if (!model.modelId) {
      throw new Error('Model identifier is required before validation.');
    }

    const detectedCapabilities = resolveDetectedCapabilities(model, provider.type);
    const startedAt = Date.now();
    let validation: LlmModelValidationResult;

    try {
      await validateModelWithAiSdk({
        provider,
        model,
        detectedCapabilities,
        fetchImpl: this.#fetchImpl,
      });

      validation = {
        providerId,
        modelId,
        ok: true,
        checkedAt: new Date().toISOString(),
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
        message: buildValidationSuccessMessage(provider, model, detectedCapabilities),
        detectedCapabilities,
      };
    } catch (error) {
      validation = {
        providerId,
        modelId,
        ok: false,
        checkedAt: new Date().toISOString(),
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        message: toError(error).message,
        detectedCapabilities,
      };
    }

    this.#llmValidations.set(createValidationKey(providerId, modelId), validation);
    return this.getLlmState();
  }

  getNeo4jState(): Neo4jPreferencesState {
    return {
      config: { ...this.#neo4jConfig },
      validation: this.#neo4jValidation ? { ...this.#neo4jValidation } : null,
    };
  }

  updateNeo4j(input: Neo4jConfigInput): Neo4jPreferencesState {
    const nextConfig = normalizeNeo4jConfig(input);

    if (nextConfig.enabled && (!nextConfig.uri || !nextConfig.username)) {
      throw new Error('Enabled Neo4j config requires both URI and username.');
    }

    this.#neo4jConfig = {
      ...nextConfig,
      updatedAt: new Date().toISOString(),
    };
    this.#neo4jValidation = null;
    this.touch();
    persistPreferences(this.#storageFilePath, this.#llmProviders, this.#neo4jConfig, this.#updatedAt, this.#readerTypography, this.#translation);
    return this.getNeo4jState();
  }

  async validateNeo4j(): Promise<Neo4jPreferencesState> {
    if (!this.#neo4jConfig.enabled) {
      throw new Error('Please enable Neo4j before running a connectivity check.');
    }

    if (!this.#neo4jConfig.uri || !this.#neo4jConfig.username) {
      throw new Error('Neo4j URI and username are required before validation.');
    }

    const startedAt = Date.now();

    try {
      const result = await this.#validateNeo4jImpl(this.#neo4jConfig);
      this.#neo4jValidation = {
        ok: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        database: result.database,
        serverAgent: result.serverAgent,
        message: result.message,
      };
    } catch (error) {
      this.#neo4jValidation = {
        ok: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        database: this.#neo4jConfig.database || null,
        serverAgent: null,
        message: toError(error).message,
      };
    }

    return this.getNeo4jState();
  }

  getReaderTypography(): ReaderTypographyState {
    return {
      config: { ...this.#readerTypography },
      updatedAt: this.#readerTypographyUpdatedAt,
    };
  }

  updateReaderTypography(input: ReaderTypographyConfigInput): ReaderTypographyState {
    this.#readerTypography = normalizeReaderTypographyInput(input);
    this.#readerTypographyUpdatedAt = new Date().toISOString();
    this.touch();
    persistPreferences(this.#storageFilePath, this.#llmProviders, this.#neo4jConfig, this.#updatedAt, this.#readerTypography, this.#translation);
    return this.getReaderTypography();
  }

  getTranslationState(): TranslationPreferencesState {
    return {
      config: { ...this.#translation },
      updatedAt: this.#translationUpdatedAt,
    };
  }

  updateTranslationPreferences(input: TranslationPreferencesInput): TranslationPreferencesState {
    this.#translation = normalizeTranslationPreferencesInput(input);
    this.#translationUpdatedAt = new Date().toISOString();
    this.touch();
    persistPreferences(this.#storageFilePath, this.#llmProviders, this.#neo4jConfig, this.#updatedAt, this.#readerTypography, this.#translation);
    return this.getTranslationState();
  }

  private touch(): void {
    this.#updatedAt = new Date().toISOString();
  }
}

function serializeProvider(
  provider: StoredLlmProviderConfig,
  validations: Map<string, LlmModelValidationResult>,
): LlmProviderConfig {
  return {
    ...provider,
    isConfigured: isProviderConfigured(provider),
    models: provider.models.map((model) => {
      const validation = validations.get(createValidationKey(provider.id, model.id));
      return {
        ...model,
        resolvedCapabilities: validation?.detectedCapabilities ?? resolveDetectedCapabilities(model, provider.type),
        lastValidatedAt: validation?.checkedAt ?? null,
        isConfigured: model.modelId.length > 0,
      };
    }),
  };
}

function normalizeProviderInputs(inputs: LlmProviderConfigInput[]): StoredLlmProviderConfig[] {
  return dedupeById(
    inputs.map((input, providerIndex) => {
      const id = normalizeIdentifier(input.id, `provider-${providerIndex + 1}`);
      return {
        id,
        label: input.label?.trim() || `Provider ${providerIndex + 1}`,
        type: input.type ?? 'openai-compatible',
        enabled: input.enabled ?? true,
        baseUrl: input.baseUrl?.trim() ?? '',
        apiKey: input.apiKey?.trim() ?? '',
        organization: input.organization?.trim() ?? '',
        models: dedupeById(
          (input.models ?? []).map((modelInput, modelIndex) => ({
            id: normalizeIdentifier(modelInput.id, `${id}-model-${modelIndex + 1}`),
            label: modelInput.label?.trim() || `模型 ${modelIndex + 1}`,
            modelId: modelInput.modelId?.trim() ?? '',
            enabled: modelInput.enabled ?? true,
            capabilityMode: modelInput.capabilityMode ?? 'manual',
            capabilities: normalizeCapabilities(modelInput.capabilities ?? ['chat']),
            defaultFor: normalizeCapabilities(modelInput.defaultFor ?? []),
          })),
        ),
      };
    }),
  );
}

function normalizeNeo4jConfig(input: Neo4jConfigInput): Neo4jConfig {
  return {
    enabled: input.enabled,
    uri: input.uri?.trim() ?? '',
    username: input.username?.trim() ?? '',
    password: input.password?.trim() ?? '',
    database: input.database?.trim() ?? '',
    isConfigured: Boolean(input.uri?.trim() && input.username?.trim()),
    updatedAt: null,
  };
}

function normalizeCapabilities(capabilities: ModelCapability[]): ModelCapability[] {
  const allowed = new Set<ModelCapability>(CAPABILITY_ORDER);
  const seen = new Set<ModelCapability>();
  const result: ModelCapability[] = [];

  for (const capability of capabilities) {
    if (!allowed.has(capability) || seen.has(capability)) {
      continue;
    }

    seen.add(capability);
    result.push(capability);
  }

  return result.length > 0 ? result : ['chat'];
}

function resolveDetectedCapabilities(
  model: Pick<StoredLlmModelConfig, 'capabilityMode' | 'capabilities' | 'modelId'>,
  providerType: LlmProviderType,
): ModelCapability[] {
  if (model.capabilityMode === 'manual') {
    return normalizeCapabilities(model.capabilities);
  }

  const samples = extractCapabilityHints(model.modelId, providerType);
  const detected: ModelCapability[] = [];

  if (samples.some((entry) => entry.includes('embed'))) {
    detected.push('embedding');
  }

  if (samples.some((entry) => entry.includes('rerank'))) {
    detected.push('rerank');
  }

  if (
    samples.some(
      (entry) =>
        entry.includes('chat') ||
        entry.includes('gpt') ||
        entry.includes('claude') ||
        entry.includes('qwen') ||
        entry.includes('llama') ||
        entry.includes('command'),
    ) ||
    detected.length === 0
  ) {
    detected.push('chat');
  }

  return normalizeCapabilities(detected);
}

function extractCapabilityHints(modelId: string, providerType: LlmProviderType): string[] {
  return [modelId.toLowerCase(), providerType.toLowerCase()];
}

function isProviderConfigured(
  provider: Pick<StoredLlmProviderConfig, 'type' | 'baseUrl' | 'apiKey'>,
): boolean {
  if (provider.baseUrl.length === 0) {
    return false;
  }

  if (provider.type === 'ollama') {
    return true;
  }

  return provider.apiKey.length > 0;
}

function buildProviderValidationRequirementMessage(type: LlmProviderType): string {
  switch (type) {
    case 'ollama':
      return 'Ollama validation requires the service base URL.';
    case 'openai-compatible':
      return 'Provider base URL and API key are required before validation.';
    case 'anthropic':
      return 'Anthropic validation requires the service base URL and API key.';
    case 'google-generative-ai':
      return 'Google Generative AI validation requires the service base URL and API key.';
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = new URL(baseUrl).toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function createValidationKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function filterValidations(
  validations: Map<string, LlmModelValidationResult>,
  providers: StoredLlmProviderConfig[],
): Map<string, LlmModelValidationResult> {
  const next = new Map<string, LlmModelValidationResult>();
  const allowedKeys = new Set(
    providers.flatMap((provider) => provider.models.map((model) => createValidationKey(provider.id, model.id))),
  );

  for (const [key, value] of validations.entries()) {
    if (allowedKeys.has(key)) {
      next.set(key, value);
    }
  }

  return next;
}

function dedupeById<TItem extends { id: string }>(items: TItem[]): TItem[] {
  const seen = new Set<string>();
  const result: TItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function normalizeIdentifier(value: string | undefined, fallbackPrefix: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `${fallbackPrefix}-${crypto.randomUUID()}`;
}

async function validateModelWithAiSdk(options: {
  provider: StoredLlmProviderConfig;
  model: StoredLlmModelConfig;
  detectedCapabilities: ModelCapability[];
  fetchImpl: typeof fetch;
}): Promise<void> {
  const validationMode = selectValidationMode(options.detectedCapabilities);

  switch (options.provider.type) {
    case 'ollama': {
      const provider = createOllama({
        baseURL: normalizeBaseUrl(options.provider.baseUrl),
        fetch: options.fetchImpl,
        ...(options.provider.apiKey ? { apiKey: options.provider.apiKey } : {}),
        ...(options.provider.apiKey || options.provider.organization
          ? { headers: buildProviderHeaders(options.provider) }
          : {}),
      });

      if (validationMode === 'rerank') {
        await validateOllamaRerankModel({
          modelId: options.model.modelId,
          provider,
        });
        return;
      }

      if (validationMode === 'embedding') {
        await embed({
          model: provider.embedding(options.model.modelId),
          value: 'ping',
        });
        return;
      }

      await generateText({
        model: provider.chat(options.model.modelId),
        prompt: 'Reply with the single word PONG.',
        maxOutputTokens: 16,
      });
      return;
    }
    case 'openai-compatible': {
      const provider = createOpenAI({
        apiKey: options.provider.apiKey,
        baseURL: buildProviderApiBaseUrl(options.provider),
        ...(options.provider.organization ? { organization: options.provider.organization } : {}),
        fetch: options.fetchImpl,
        name: 'openai-compatible',
      });

      if (validationMode === 'embedding') {
        await embed({
          model: provider.embedding(options.model.modelId),
          value: 'ping',
        });
        return;
      }

      if (validationMode === 'rerank') {
        await validateNativeRerankModel({
          provider: options.provider,
          modelId: options.model.modelId,
          fetchImpl: options.fetchImpl,
        });
        return;
      }

      await generateText({
        model: provider.chat(options.model.modelId),
        prompt: 'Reply with the single word PONG.',
        maxOutputTokens: 16,
      });
      return;
    }
    case 'anthropic': {
      if (validationMode === 'embedding' || validationMode === 'rerank') {
        throw new Error('Anthropic provider does not expose embedding or rerank models through the current validation path.');
      }

      const provider = createAnthropic({
        apiKey: options.provider.apiKey,
        baseURL: normalizeBaseUrl(options.provider.baseUrl),
        fetch: options.fetchImpl,
      });

      await generateText({
        model: provider(options.model.modelId),
        prompt: 'Reply with the single word PONG.',
        maxOutputTokens: 16,
      });
      return;
    }
    case 'google-generative-ai': {
      const provider = createGoogleGenerativeAI({
        apiKey: options.provider.apiKey,
        baseURL: normalizeBaseUrl(options.provider.baseUrl),
        fetch: options.fetchImpl,
      });

      if (validationMode === 'rerank') {
        throw new Error('Google Generative AI rerank validation is not exposed through the current validation path.');
      }

      if (validationMode === 'embedding') {
        await embed({
          model: provider.embedding(options.model.modelId),
          value: 'ping',
        });
        return;
      }

      await generateText({
        model: provider(options.model.modelId),
        prompt: 'Reply with the single word PONG.',
        maxOutputTokens: 16,
      });
      return;
    }
  }
}

async function validateOllamaRerankModel(options: {
  modelId: string;
  provider: ReturnType<typeof createOllama>;
}): Promise<void> {
  const result = await rerank({
    model: options.provider.embeddingReranking(options.modelId),
    query: 'Which document is about rain?',
    documents: ['A sunny walk at the beach.', 'A rainy afternoon in the city.'],
    topN: 1,
  });

  if (result.ranking.length === 0) {
    throw new Error('Ollama rerank validation did not return any ranked documents.');
  }

  if (!result.ranking.every((entry) => Number.isFinite(entry.score))) {
    throw new Error('Ollama rerank validation did not produce usable relevance scores.');
  }
}

async function discoverProviderModels(options: {
  provider: StoredLlmProviderConfig;
  fetchImpl: typeof fetch;
}): Promise<LlmDiscoveredModel[]> {
  switch (options.provider.type) {
    case 'openai-compatible': {
      const payload = await fetchJsonPayload({
        url: buildModelCatalogEndpoint(options.provider),
        fetchImpl: options.fetchImpl,
        headers: buildJsonRequestHeaders(options.provider),
      });

      return parseOpenAiCompatibleModels(payload, options.provider.type);
    }
    case 'anthropic': {
      const payload = await fetchJsonPayload({
        url: buildModelCatalogEndpoint(options.provider),
        fetchImpl: options.fetchImpl,
        headers: buildAnthropicRequestHeaders(options.provider),
      });

      return parseAnthropicModels(payload);
    }
    case 'google-generative-ai': {
      const payload = await fetchJsonPayload({
        url: buildGoogleModelCatalogEndpoint(options.provider),
        fetchImpl: options.fetchImpl,
        headers: {
          Accept: 'application/json',
        },
      });

      return parseGoogleGenerativeAiModels(payload);
    }
    case 'ollama': {
      const payload = await fetchJsonPayload({
        url: buildOllamaApiEndpoint(options.provider.baseUrl, '/tags'),
        fetchImpl: options.fetchImpl,
        headers: {
          Accept: 'application/json',
          ...buildProviderHeaders(options.provider),
        },
      });

      return parseOllamaModels(payload);
    }
  }
}

async function fetchJsonPayload(options: {
  url: string;
  fetchImpl: typeof fetch;
  headers: HeadersInit;
}): Promise<unknown> {
  const response = await options.fetchImpl(options.url, {
    method: 'GET',
    headers: options.headers,
  });
  const payload = await safeReadJson(response);

  if (!response.ok) {
    throw new Error(readValidationErrorMessage(response, payload));
  }

  return payload;
}

async function validateNativeRerankModel(options: {
  provider: StoredLlmProviderConfig;
  modelId: string;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const response = await options.fetchImpl(buildRerankEndpoint(options.provider), {
    method: 'POST',
    headers: buildJsonRequestHeaders(options.provider),
    body: JSON.stringify({
      model: options.modelId,
      query: 'Which document is about rain?',
      documents: ['A sunny walk at the beach.', 'A rainy afternoon in the city.'],
      top_n: 1,
      topN: 1,
    }),
  });

  const payload = await safeReadJson(response);

  if (!response.ok) {
    throw new Error(readValidationErrorMessage(response, payload));
  }

  if (!isRecognizedRerankResponse(payload)) {
    throw new Error('Provider responded successfully, but did not return a recognizable rerank payload.');
  }
}

function selectValidationMode(capabilities: ModelCapability[]): 'chat' | 'embedding' | 'rerank' {
  if (capabilities.includes('chat')) {
    return 'chat';
  }

  if (capabilities.includes('embedding')) {
    return 'embedding';
  }

  if (capabilities.includes('rerank')) {
    return 'rerank';
  }

  throw new Error('Current model does not declare a supported validation capability.');
}

function buildValidationSuccessMessage(
  provider: StoredLlmProviderConfig,
  model: StoredLlmModelConfig,
  detectedCapabilities: ModelCapability[],
): string {
  const validationMode = selectValidationMode(detectedCapabilities);
  const mode =
    validationMode === 'embedding'
      ? 'embedding'
      : validationMode === 'rerank'
        ? 'rerank'
        : 'language';
  return `${provider.label} / ${model.modelId} passed ${mode} validation through AI SDK.`;
}

function buildModelCatalogEndpoint(provider: Pick<StoredLlmProviderConfig, 'type' | 'baseUrl'>): string {
  return `${buildProviderApiBaseUrl(provider)}/models`;
}

function buildGoogleModelCatalogEndpoint(provider: Pick<StoredLlmProviderConfig, 'baseUrl' | 'apiKey'>): string {
  const url = new URL(`${normalizeBaseUrl(provider.baseUrl)}/models`);
  if (provider.apiKey) {
    url.searchParams.set('key', provider.apiKey);
  }

  return url.toString();
}

function buildRerankEndpoint(provider: Pick<StoredLlmProviderConfig, 'type' | 'baseUrl'>): string {
  return `${buildProviderApiBaseUrl(provider)}/rerank`;
}

function buildProviderApiBaseUrl(provider: Pick<StoredLlmProviderConfig, 'type' | 'baseUrl'>): string {
  const normalizedBaseUrl = normalizeBaseUrl(provider.baseUrl);

  if (provider.type !== 'openai-compatible') {
    return normalizedBaseUrl;
  }

  const url = new URL(normalizedBaseUrl);
  const normalizedPath = url.pathname.replace(/\/+$/, '');

  if (normalizedPath.length === 0) {
    url.pathname = '/v1';
    return url.toString().replace(/\/$/, '');
  }

  return normalizedBaseUrl;
}

function buildOllamaApiEndpoint(baseUrl: string, pathName: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (normalizedBaseUrl.endsWith('/api')) {
    return `${normalizedBaseUrl}${pathName}`;
  }

  return `${normalizedBaseUrl}/api${pathName}`;
}

function buildProviderHeaders(provider: Pick<StoredLlmProviderConfig, 'apiKey' | 'organization'>): Record<string, string> {
  return {
    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    ...(provider.organization ? { 'OpenAI-Organization': provider.organization } : {}),
  };
}

function buildAnthropicRequestHeaders(provider: Pick<StoredLlmProviderConfig, 'apiKey'>): HeadersInit {
  return {
    Accept: 'application/json',
    'x-api-key': provider.apiKey,
    'anthropic-version': '2023-06-01',
  };
}

function buildJsonRequestHeaders(
  provider: Pick<StoredLlmProviderConfig, 'apiKey' | 'organization'>,
): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...buildProviderHeaders(provider),
  };
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecognizedRerankResponse(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    Array.isArray(payload.results) ||
    Array.isArray(payload.data) ||
    Array.isArray(payload.ranking)
  );
}

function readValidationErrorMessage(response: Response, payload: unknown): string {
  if (isRecord(payload) && typeof payload.error === 'string') {
    return payload.error;
  }

  if (isRecord(payload) && typeof payload.message === 'string') {
    return payload.message;
  }

  return `Provider validation returned ${response.status} ${response.statusText}.`;
}

function parseOpenAiCompatibleModels(payload: unknown, providerType: LlmProviderType): LlmDiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Provider responded successfully, but did not return a recognizable model catalog payload.');
  }

  return dedupeDiscoveredModels(
    payload.data.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string') {
        return [];
      }

      return [createDiscoveredModel({ modelId: entry.id, providerType })];
    }),
  );
}

function parseAnthropicModels(payload: unknown): LlmDiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('Provider responded successfully, but did not return a recognizable model catalog payload.');
  }

  return dedupeDiscoveredModels(
    payload.data.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string') {
        return [];
      }

      const label =
        typeof entry.display_name === 'string'
          ? entry.display_name
          : typeof entry.displayName === 'string'
            ? entry.displayName
            : entry.id;

      const description = typeof entry.type === 'string' ? `Anthropic ${entry.type}` : null;

      return [createDiscoveredModel({ modelId: entry.id, label, description, providerType: 'anthropic' })];
    }),
  );
}

function parseGoogleGenerativeAiModels(payload: unknown): LlmDiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    throw new Error('Provider responded successfully, but did not return a recognizable model catalog payload.');
  }

  return dedupeDiscoveredModels(
    payload.models.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.name !== 'string') {
        return [];
      }

      const modelId = entry.name.startsWith('models/') ? entry.name.slice('models/'.length) : entry.name;
      const label = typeof entry.displayName === 'string' ? entry.displayName : modelId;
      const description = typeof entry.description === 'string' ? entry.description : null;

      return [
        createDiscoveredModel({
          modelId,
          label,
          description,
          providerType: 'google-generative-ai',
          detectedCapabilities: detectGoogleCatalogCapabilities(entry, modelId),
        }),
      ];
    }),
  );
}

function parseOllamaModels(payload: unknown): LlmDiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    throw new Error('Provider responded successfully, but did not return a recognizable model catalog payload.');
  }

  return dedupeDiscoveredModels(
    payload.models.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.name !== 'string') {
        return [];
      }

      let description: string | null = null;
      if (isRecord(entry.details)) {
        const parts = [entry.details.family, entry.details.parameter_size, entry.details.format].filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        );
        description = parts.length > 0 ? parts.join(' / ') : null;
      }

      return [createDiscoveredModel({ modelId: entry.name, description, providerType: 'ollama' })];
    }),
  );
}

function createDiscoveredModel(options: {
  modelId: string;
  providerType: LlmProviderType;
  label?: string;
  description?: string | null;
  detectedCapabilities?: ModelCapability[];
}): LlmDiscoveredModel {
  return {
    modelId: options.modelId,
    label: options.label ?? options.modelId,
    description: options.description ?? null,
    detectedCapabilities:
      options.detectedCapabilities ??
      resolveDetectedCapabilities(
        {
          capabilityMode: 'auto',
          capabilities: [],
          modelId: options.modelId,
        },
        options.providerType,
      ),
  };
}

function detectGoogleCatalogCapabilities(entry: Record<string, unknown>, modelId: string): ModelCapability[] {
  if (!Array.isArray(entry.supportedGenerationMethods)) {
    return resolveDetectedCapabilities(
      {
        capabilityMode: 'auto',
        capabilities: [],
        modelId,
      },
      'google-generative-ai',
    );
  }

  const methods = entry.supportedGenerationMethods.filter((value): value is string => typeof value === 'string');
  const capabilities: ModelCapability[] = [];

  if (methods.some((value) => value === 'generateContent' || value === 'streamGenerateContent')) {
    capabilities.push('chat');
  }

  if (methods.some((value) => value === 'embedContent' || value === 'batchEmbedContents')) {
    capabilities.push('embedding');
  }

  return normalizeCapabilities(capabilities.length > 0 ? capabilities : ['chat']);
}

function dedupeDiscoveredModels(models: LlmDiscoveredModel[]): LlmDiscoveredModel[] {
  const seen = new Set<string>();

  return models
    .filter((entry) => {
      const key = entry.modelId.trim().toLowerCase();
      if (key.length === 0 || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((left, right) => left.modelId.localeCompare(right.modelId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function loadPersistedPreferences(storageFilePath: string): PersistedSystemPreferences | null {
  try {
    if (!fs.existsSync(storageFilePath)) {
      return null;
    }

    const fileContent = fs.readFileSync(storageFilePath, 'utf8');
    const parsed = JSON.parse(fileContent) as {
      llmProviders?: unknown;
      neo4j?: unknown;
      readerTypography?: unknown;
      translation?: unknown;
      updatedAt?: unknown;
    };

    let readerTypography: ReaderTypographyConfigInput | undefined;

    if (isRecord(parsed.readerTypography)) {
      const rt: ReaderTypographyConfigInput = {};
      const raw = parsed.readerTypography as Record<string, unknown>;

      if (typeof raw.fontSize === 'number') { rt.fontSize = raw.fontSize; }
      if (isFontSizePreset(raw.fontSizePreset)) { rt.fontSizePreset = raw.fontSizePreset; }
      if (typeof raw.lineHeight === 'number') { rt.lineHeight = raw.lineHeight; }
      if (typeof raw.paragraphSpacing === 'number') { rt.paragraphSpacing = raw.paragraphSpacing; }
      if (isFontFamilyPreset(raw.fontFamilyPreset)) { rt.fontFamilyPreset = raw.fontFamilyPreset; }
      if (typeof raw.fontFamilyCustom === 'string') { rt.fontFamilyCustom = raw.fontFamilyCustom; }

      readerTypography = rt;
    }

    const result: PersistedSystemPreferences = {
      llmProviders: Array.isArray(parsed.llmProviders)
        ? parsed.llmProviders.filter((entry): entry is LlmProviderConfigInput => isRecord(entry))
        : [],
      neo4j: isRecord(parsed.neo4j)
        ? {
            enabled: typeof parsed.neo4j.enabled === 'boolean' ? parsed.neo4j.enabled : false,
            uri: typeof parsed.neo4j.uri === 'string' ? parsed.neo4j.uri : '',
            username: typeof parsed.neo4j.username === 'string' ? parsed.neo4j.username : '',
            password: typeof parsed.neo4j.password === 'string' ? parsed.neo4j.password : '',
            database: typeof parsed.neo4j.database === 'string' ? parsed.neo4j.database : '',
          }
        : { enabled: false },
      updatedAt:
        typeof parsed.updatedAt === 'string' || parsed.updatedAt === null ? parsed.updatedAt : null,
    };

    if (readerTypography) {
      result.readerTypography = readerTypography;
    }

    if (isRecord(parsed.translation)) {
      result.translation = parsed.translation as TranslationPreferencesInput;
    }

    return result;
  } catch {
    return null;
  }
}

function persistPreferences(
  storageFilePath: string | null,
  llmProviders: StoredLlmProviderConfig[],
  neo4jConfig: Neo4jConfig,
  updatedAt: string | null,
  readerTypography?: ReaderTypographyConfig,
  translation?: TranslationPreferencesConfig,
): void {
  if (!storageFilePath) {
    return;
  }

  fs.mkdirSync(path.dirname(storageFilePath), { recursive: true });
  const payload: Record<string, unknown> = {
    llmProviders,
    neo4j: {
      enabled: neo4jConfig.enabled,
      uri: neo4jConfig.uri,
      username: neo4jConfig.username,
      password: neo4jConfig.password,
      database: neo4jConfig.database,
      updatedAt: neo4jConfig.updatedAt,
    },
    updatedAt,
  };

  if (readerTypography) {
    payload.readerTypography = readerTypography;
  }

  if (translation) {
    payload.translation = translation;
  }

  fs.writeFileSync(
    storageFilePath,
    JSON.stringify(payload, null, 2),
    'utf8',
  );
}

async function defaultNeo4jValidator(config: Neo4jConfig): Promise<Pick<Neo4jValidationResult, 'database' | 'message' | 'serverAgent'>> {
  const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));

  try {
    await driver.verifyConnectivity();
    const session = config.database
      ? driver.session({ database: config.database })
      : driver.session();

    try {
      const result = await session.run('RETURN 1 AS ok');
      return {
        database: config.database || null,
        serverAgent: driver.getServerInfo ? (await driver.getServerInfo()).agent ?? null : null,
        message: result.records.length > 0 ? 'Neo4j connectivity check succeeded.' : 'Neo4j responded without returning the expected probe row.',
      };
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}