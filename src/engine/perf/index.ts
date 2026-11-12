export {
  classifyGpu,
  detectDeviceProfile,
  detectMobile,
  isRealBrowserMobile,
  estimateInitialTier,
  getDeviceCacheKey,
  resetEphemeralWebGlGpuProbeCache,
  type DeviceProfile,
  type ExtendedNavigator,
} from './device-tier.ts';
export {
  GRAPHICS_TIER_ORDER,
  clampPixelRatioForTier,
  compareTiers,
  getPointLightBudget,
  getTierPixelRatioRange,
  getTierSettings,
  isGraphicsTier,
  stepTier,
  withPixelRatio,
  type PixelRatioRange,
} from './tier-settings.ts';
export {
  GRAPHICS_MODE_STORAGE_KEY,
  PerformanceGovernor,
  QUALITY_REDUCED_TOAST,
  type PerformanceGovernorOptions,
  type PerformanceGovernorStats,
} from './performance-governor.ts';
