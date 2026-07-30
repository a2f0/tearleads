# frozen_string_literal: true

require 'dotenv'

NATIVE_RELEASE_TARGETS = {
  'production' => {
    android_build_variant: 'release',
    app_identifier: 'com.tearleads.app',
    ios_configuration: 'Release',
    ios_scheme: 'App'
  }.freeze,
  'staging' => {
    android_build_variant: 'staging',
    app_identifier: 'com.tearleads.app.staging',
    ios_configuration: 'Release-Staging',
    ios_scheme: 'App-Staging'
  }.freeze
}.freeze

NATIVE_RELEASE_TIER = ENV.fetch('NATIVE_RELEASE_TIER', 'production').strip.downcase
NATIVE_RELEASE_TARGET = NATIVE_RELEASE_TARGETS.fetch(NATIVE_RELEASE_TIER) do
  raise "Unknown NATIVE_RELEASE_TIER=#{NATIVE_RELEASE_TIER.inspect}. Expected production or staging."
end
NATIVE_APP_IDENTIFIER = NATIVE_RELEASE_TARGET.fetch(:app_identifier)
NATIVE_CAPACITOR_SYNC_SCRIPT = NATIVE_RELEASE_TIER == 'staging' ? 'cap:sync:staging' : 'cap:sync:release'
NATIVE_REPO_ROOT = File.expand_path('../../..', __dir__)
NATIVE_SECRETS_DIR = File.join(NATIVE_REPO_ROOT, '.secrets')
NATIVE_ROOT_ENV_PATH = File.join(NATIVE_SECRETS_DIR, 'root.env')
NATIVE_STAGING_ENV_PATH = File.join(NATIVE_SECRETS_DIR, 'staging.env')
NATIVE_STAGING_ENV_NAMES = %w[
  VITE_REVENUECAT_ANDROID_API_KEY
  VITE_REVENUECAT_IOS_API_KEY
].freeze
NATIVE_SHARED_VITE_ENV_NAMES = %w[
  VITE_REVENUECAT_SYNC_ENTITLEMENT
].freeze

def parsed_native_release_env(path)
  File.file?(path) ? Dotenv.parse(path) : {}
end

# Staging keeps signing and store credentials from root.env, but only explicitly
# shared Vite settings. Its server-oriented staging.env may contain unrelated
# deploy secrets, so import only the two native RevenueCat public keys.
def native_release_file_environment
  root_environment = parsed_native_release_env(NATIVE_ROOT_ENV_PATH)
  return root_environment unless NATIVE_RELEASE_TIER == 'staging'

  root_environment.delete_if do |name, _value|
    name.start_with?('VITE_') && !NATIVE_SHARED_VITE_ENV_NAMES.include?(name)
  end
  staging_environment = parsed_native_release_env(NATIVE_STAGING_ENV_PATH)
  staging_environment.select! { |name, _value| NATIVE_STAGING_ENV_NAMES.include?(name) }

  root_environment.merge(staging_environment)
end

# Load release values while preserving every variable explicitly set by the
# caller. Parsing first lets the tier-specific native allowlist override root.
def load_native_release_secrets_env
  process_environment = ENV.to_h

  native_release_file_environment.each do |name, value|
    ENV[name] = value unless process_environment.key?(name)
  end
end
