# frozen_string_literal: true

require 'dotenv'
require 'uri'

NATIVE_RELEASE_TARGETS = {
  'production' => {
    android_build_variant: 'release',
    api_host: 'api.symcrypt.com',
    app_identifier: 'com.symcrypt.app',
    capacitor_sync_script: 'cap:sync:release',
    ios_archive_name: 'SymCrypt.xcarchive',
    ios_configuration: 'Release',
    ios_ipa_name: 'SymCrypt.ipa',
    ios_output_directory: 'output',
    ios_scheme: 'App'
  }.freeze,
  'staging' => {
    android_build_variant: 'staging',
    api_host: 'api-staging.symcrypt.com',
    app_identifier: 'com.symcrypt.staging.app',
    capacitor_sync_script: 'cap:sync:staging',
    ios_archive_name: 'SymCrypt-Staging.xcarchive',
    ios_configuration: 'Release-Staging',
    ios_ipa_name: 'SymCrypt-Staging.ipa',
    ios_output_directory: 'output/staging',
    ios_scheme: 'App-Staging'
  }.freeze
}.freeze

NATIVE_RELEASE_TIER = ENV.fetch('NATIVE_RELEASE_TIER', 'production').strip.downcase
NATIVE_RELEASE_TARGET = NATIVE_RELEASE_TARGETS.fetch(NATIVE_RELEASE_TIER) do
  raise "Unknown NATIVE_RELEASE_TIER=#{NATIVE_RELEASE_TIER.inspect}. Expected production or staging."
end
NATIVE_APP_IDENTIFIER = NATIVE_RELEASE_TARGET.fetch(:app_identifier)
NATIVE_CAPACITOR_SYNC_SCRIPT = NATIVE_RELEASE_TARGET.fetch(:capacitor_sync_script)
NATIVE_REPO_ROOT = File.expand_path('../../../..', __dir__)
NATIVE_SECRETS_DIR = File.join(NATIVE_REPO_ROOT, '.secrets')
NATIVE_ROOT_ENV_PATH = File.join(NATIVE_SECRETS_DIR, 'root.env')
NATIVE_STAGING_ENV_PATH = File.join(NATIVE_SECRETS_DIR, 'staging.env')
NATIVE_SHARED_VITE_ENV_NAMES = %w[
  VITE_REVENUECAT_SYNC_ENTITLEMENT
].freeze
NATIVE_STAGING_PLATFORM_VITE_ENV_NAMES = %w[
  VITE_REVENUECAT_ANDROID_API_KEY
  VITE_REVENUECAT_IOS_API_KEY
].freeze
NATIVE_RELEASE_MANAGED_VITE_ENV_NAMES = %w[
  VITE_API_BASE_URL
  VITE_APP_VERSION
  VITE_GIT_SHA
  VITE_WS_URL
].freeze
NATIVE_STAGING_ENV_NAMES = (
  NATIVE_STAGING_PLATFORM_VITE_ENV_NAMES + NATIVE_SHARED_VITE_ENV_NAMES
).freeze

def native_release_android_build_variant_task
  NATIVE_RELEASE_TARGET.fetch(:android_build_variant).capitalize
end

def native_release_android_artifact_relative_paths
  variant = NATIVE_RELEASE_TARGET.fetch(:android_build_variant)
  {
    aab: "bundle/#{variant}/app-#{variant}.aab",
    mapping: "mapping/#{variant}/mapping.txt",
    native_debug_symbols: "native-debug-symbols/#{variant}/native-debug-symbols.zip"
  }.freeze
end

def native_release_ios_archive_relative_path
  File.join(
    NATIVE_RELEASE_TARGET.fetch(:ios_output_directory),
    NATIVE_RELEASE_TARGET.fetch(:ios_archive_name)
  )
end

def parsed_native_release_env(path)
  File.file?(path) ? Dotenv.parse(path) : {}
end

def warn_ignored_native_staging_vite_names(environment, source, allowed_names)
  ignored_names = environment.keys.select do |name|
    name.start_with?('VITE_') && !allowed_names.include?(name)
  end
  return if ignored_names.empty?

  warn "Ignoring #{source} Vite settings for staging: #{ignored_names.sort.join(', ')}"
end

def native_release_staging_root_environment(root_environment)
  warn_ignored_native_staging_vite_names(
    root_environment,
    'root.env',
    NATIVE_SHARED_VITE_ENV_NAMES
  )
  root_environment.delete_if do |name, _value|
    name.start_with?('VITE_') && !NATIVE_SHARED_VITE_ENV_NAMES.include?(name)
  end
end

def native_release_staging_environment
  staging_environment = parsed_native_release_env(NATIVE_STAGING_ENV_PATH)
  warn_ignored_native_staging_vite_names(
    staging_environment,
    'staging.env',
    NATIVE_STAGING_ENV_NAMES
  )
  staging_environment.slice(*NATIVE_STAGING_ENV_NAMES)
end

# Staging keeps signing and store credentials from root.env, but only explicitly
# shared Vite settings. Its server-oriented staging.env may contain unrelated
# deploy secrets, so import only native RevenueCat client settings.
def native_release_file_environment
  root_environment = parsed_native_release_env(NATIVE_ROOT_ENV_PATH)
  return root_environment unless NATIVE_RELEASE_TIER == 'staging'

  native_release_staging_root_environment(root_environment).merge(
    native_release_staging_environment
  )
end

# Load release values while preserving every variable explicitly set by the
# caller. Parsing first lets the tier-specific native allowlist override root.
def load_native_release_secrets_env(validate_service_urls: true)
  process_environment = ENV.to_h

  native_release_file_environment.each do |name, value|
    ENV[name] = value unless process_environment.key?(name)
  end

  if ENV.fetch('VITE_API_BASE_URL', '').strip.empty?
    ENV['VITE_API_BASE_URL'] = "https://#{NATIVE_RELEASE_TARGET.fetch(:api_host)}"
  end
  ensure_native_release_service_urls! if validate_service_urls
end

def native_release_api_host_problem(host)
  expected_host = NATIVE_RELEASE_TARGET.fetch(:api_host)
  return nil if host == expected_host

  "must use #{expected_host} for a #{NATIVE_RELEASE_TIER} release"
end

def native_release_websocket_host_problem(host)
  expected_host = NATIVE_RELEASE_TARGET.fetch(:api_host)
  return nil if host == expected_host

  "must use #{expected_host} for a #{NATIVE_RELEASE_TIER} release"
end

def native_release_parsed_url_problem(env_name, parsed_url)
  expected_scheme = env_name == 'VITE_API_BASE_URL' ? 'https' : 'wss'
  return "must use the #{expected_scheme} scheme" unless parsed_url.scheme.to_s.downcase == expected_scheme

  host = parsed_url.host.to_s.downcase.delete_suffix('.')
  return 'must be an absolute URL with a host' if host.empty?

  return native_release_api_host_problem(host) if env_name == 'VITE_API_BASE_URL'

  native_release_websocket_host_problem(host)
end

def native_release_service_url_problem(env_name, value)
  url = value.to_s.strip
  return nil if url.empty?

  native_release_parsed_url_problem(env_name, URI.parse(url))
rescue URI::InvalidURIError
  'must be an absolute URL with a host'
end

def ensure_native_release_service_urls!
  %w[VITE_API_BASE_URL VITE_WS_URL].each do |env_name|
    problem = native_release_service_url_problem(env_name, ENV.fetch(env_name, nil))
    next if problem.nil?

    message = "#{env_name} #{problem}."
    defined?(UI) ? UI.user_error!(message) : raise(message)
  end
end

# Production must resolve to an independent source value so exported candidates
# stay consistent with the configured production key; staging must differ from
# that value. A caller-supplied baseline supports env-only CI and key rotation.
def native_release_production_store_key(env_name)
  baseline_name = "NATIVE_RELEASE_PRODUCTION_#{env_name}"
  explicit_baseline = ENV.fetch(baseline_name, '').strip
  return explicit_baseline unless explicit_baseline.empty?

  parsed_native_release_env(NATIVE_ROOT_ENV_PATH)[env_name]
end
