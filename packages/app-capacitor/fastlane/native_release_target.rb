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

def native_release_env_paths
  paths = [NATIVE_ROOT_ENV_PATH]
  paths << File.join(NATIVE_SECRETS_DIR, 'staging.env') if NATIVE_RELEASE_TIER == 'staging'
  paths
end

# Load root plus tier-specific values while preserving variables explicitly set
# by the caller. Dotenv.load cannot express both requirements: it preserves the
# process environment, but it also lets root.env win over staging.env. Parsing
# and merging first gives the tier the expected precedence.
def load_native_release_secrets_env
  process_environment = ENV.to_h
  file_environment = native_release_env_paths.each_with_object({}) do |path, values|
    values.merge!(Dotenv.parse(path)) if File.file?(path)
  end

  file_environment.each do |name, value|
    ENV[name] = value unless process_environment.key?(name)
  end

  clear_inherited_staging_revenuecat_keys!(process_environment)
end

# A staging app must have a RevenueCat app whose configured platform identifier
# is com.tearleads.app.staging. Do not inherit the production platform key from
# root.env when staging.env has not supplied its own value.
def clear_inherited_staging_revenuecat_keys!(process_environment)
  return unless NATIVE_RELEASE_TIER == 'staging'

  %w[VITE_REVENUECAT_ANDROID_API_KEY VITE_REVENUECAT_IOS_API_KEY].each do |name|
    next if process_environment.key?(name) || file_environment_from_staging?(name)

    ENV.delete(name)
  end
end

def file_environment_from_staging?(name)
  staging_path = File.join(NATIVE_SECRETS_DIR, 'staging.env')
  File.file?(staging_path) && Dotenv.parse(staging_path).key?(name)
end
