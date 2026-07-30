# frozen_string_literal: true

require 'json'

require File.realpath(ARGV.fetch(0))

load_native_release_secrets_env
android_artifact_paths = native_release_android_artifact_relative_paths
environment_names = %w[
  DEEPSEEK_API_KEY
  NATIVE_TEST_VALUE
  VITE_API_BASE_URL
  VITE_REVENUECAT_ANDROID_API_KEY
  VITE_REVENUECAT_IOS_API_KEY
  VITE_REVENUECAT_SYNC_ENTITLEMENT
  VITE_WS_URL
]

print JSON.generate(
  androidBuildVariant: NATIVE_RELEASE_TARGET.fetch(:android_build_variant),
  androidBuildVariantTask: native_release_android_build_variant_task,
  appIdentifier: NATIVE_APP_IDENTIFIER,
  iosArchiveRelativePath: native_release_ios_archive_relative_path,
  productionIosStoreKey: native_release_production_store_key('VITE_REVENUECAT_IOS_API_KEY'),
  releaseAabRelativePath: android_artifact_paths.fetch(:aab),
  releaseMappingRelativePath: android_artifact_paths.fetch(:mapping),
  releaseNativeDebugSymbolsRelativePath: android_artifact_paths.fetch(:native_debug_symbols),
  environment: environment_names.to_h { |name| [name, ENV.fetch(name, nil)] },
  iosConfiguration: NATIVE_RELEASE_TARGET.fetch(:ios_configuration),
  iosScheme: NATIVE_RELEASE_TARGET.fetch(:ios_scheme)
)
