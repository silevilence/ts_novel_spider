import type { RefinedModelRoute, RefinedTranslationModelConfig } from './novel-repository';
import type { SystemPreferencesService } from './system-preferences';
import { resolveCapabilityRoute } from './library-intelligence';

/** 查实际提供商配置，不能由模型名称推测翻译格式。 */
export function refinedModelFormat(preferences: SystemPreferencesService, route: RefinedModelRoute) {
  return preferences.getLlmState().providers.find((provider) => provider.id === route.providerId)?.models
    .find((model) => model.id === route.modelId || model.modelId === route.modelId)?.translationMessageFormat ?? 'general';
}

/** 对话回退仅在普通格式的有效模型中进行，绝不借用专用翻译模型。 */
export function resolveRefinedChatRoute(preferences: SystemPreferencesService, configured: RefinedModelRoute | null): RefinedModelRoute | null {
  const state = preferences.getLlmState();
  const filtered = { ...state, providers: state.providers.map((provider) => ({ ...provider, models: provider.models.filter((model) => model.isConfigured && model.resolvedCapabilities.includes('chat') && model.translationMessageFormat === 'general') })) };
  const resolved = resolveCapabilityRoute(filtered, 'chat', configured, preferences.getModelGateway());
  if (!resolved) return null;
  return { providerId: resolved.provider.id, modelId: resolved.model.modelId, ...(resolved.source === 'novel' && configured?.thinkingEnabled !== undefined ? { thinkingEnabled: configured.thinkingEnabled } : {}) };
}

/** 保存时拒绝职责冲突；调用时仍会重新检查已禁用或被删除的配置。 */
export function validateRefinedModelRoles(preferences: SystemPreferencesService, config: RefinedTranslationModelConfig): RefinedTranslationModelConfig {
  for (const key of ['termExtractionModel', 'termTranslationModel', 'omissionModel', 'reviewModel'] as const) {
    const route = config[key];
    if (route && refinedModelFormat(preferences, route) !== 'general') throw new Error(`${key} 必须使用普通对话模型，专用翻译模型仅用于初翻与段落修订。`);
  }
  return { ...config, translationModels: config.translationModels.map((route) => refinedModelFormat(preferences, route) === 'bilibili-index-translate' ? { ...route, thinkingEnabled: false } : route) };
}
