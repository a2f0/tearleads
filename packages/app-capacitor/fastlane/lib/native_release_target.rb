# frozen_string_literal: true

require 'dotenv'
require 'uri'

NATIVE_RELEASE_TARGETS = {
  'production' => {
    android_build_variant: 'release',
    api_host: 'api.tearleads.com',
    app_identifier: 'com.tearleads.app',
    capacitor_sync_script: 'cap:sync:release',
    ios_archive_name: 'Tearleads.xcarchive',
    ios_configuration: 'Release',
    ios_ipa_name: 'Tearleads.ipa',
    ios_output_directory: 'output',
    ios_scheme: 'App',
    secrets_tier: 'prod'
  }.freeze,
  'staging' => {
    android_build_variant: 'staging',
    api_host: 'api-staging.tearleads.com',
    app_identifier: 'com.tearleads.staging.app',
    capacitor_sync_script: 'cap:sync:staging',
    ios_archive_name: 'Tearleads-Staging.xcarchive',
    ios_configuration: 'Release-Staging',
    ios_ipa_name: 'Tearleads-Staging.ipa',
    ios_output_directory: 'output/staging',
    ios_scheme: 'App-Staging',
    secrets_tier: 'staging'
  }.freeze
}.freeze

NATIVE_RELEASE_TIER = ENV.fetch('NATIVE_RELEASE_TIER', 'production').strip.downcase
NATIVE_RELEASE_TARGET = NATIVE_RELEASE_TARGETS.fetch(NATIVE_RELEASE_TIER) do
  raise "Unknown NATIVE_RELEASE_TIER=#{NATIVE_RELEASE_TIER.inspect}. " \
        "Expected #{NATIVE_RELEASE_TARGETS.keys.join(' or ')}."
end
NATIVE_APP_IDENTIFIER = NATIVE_RELEASE_TARGET.fetch(:app_identifier)
NATIVE_CAPACITOR_SYNC_SCRIPT = NATIVE_RELEASE_TARGET.fetch(:capacitor_sync_script)
NATIVE_PACKAGE_DIR = File.expand_path('../..', __dir__)
NATIVE_REPO_ROOT = File.expand_path('../..', NATIVE_PACKAGE_DIR)

def native_release_tier_secrets_dir(tier)
  File.join(NATIVE_REPO_ROOT, '.secrets', NATIVE_RELEASE_TARGETS.fetch(tier).fetch(:secrets_tier))
end

# Each tier reads only its own `.secrets/<secrets tier>/` folder: signing keys,
# store credentials, `shared.env` (the values shared with other projects), and
# `app.env` (this project's). NATIVE_RELEASE_SECRETS_DIR names another folder
# instead; a relative path resolves against this package, as Gradle and the
# native web build resolve it.
NATIVE_RELEASE_SECRETS_DIR_OVERRIDE = ENV.fetch('NATIVE_RELEASE_SECRETS_DIR', '').strip
NATIVE_SECRETS_DIR =
  if NATIVE_RELEASE_SECRETS_DIR_OVERRIDE.empty?
    native_release_tier_secrets_dir(NATIVE_RELEASE_TIER)
  else
    File.expand_path(NATIVE_RELEASE_SECRETS_DIR_OVERRIDE, NATIVE_PACKAGE_DIR)
  end
NATIVE_SHARED_ENV_PATH = File.join(NATIVE_SECRETS_DIR, 'shared.env')
NATIVE_APP_ENV_PATH = File.join(NATIVE_SECRETS_DIR, 'app.env')
# Production compares its RevenueCat keys with the shared.env it loads; staging
# compares with production's.
NATIVE_PRODUCTION_SHARED_ENV_PATH =
  if NATIVE_RELEASE_TIER == 'production'
    NATIVE_SHARED_ENV_PATH
  else
    File.join(native_release_tier_secrets_dir('production'), 'shared.env')
  end
# Store credentials and signing passwords, imported from either file. Values
# copied from root.env stay in shared.env until they are rotated into app.env.
NATIVE_STORE_ENV_NAMES = %w[
  ANDROID_KEYSTORE_KEY_PASS
  ANDROID_KEYSTORE_STORE_PASS
  APP_STORE_CONNECT_ISSUER_ID
  APP_STORE_CONNECT_KEY_ID
  MATCH_GIT_BASIC_AUTHORIZATION
  MATCH_GIT_URL
  MATCH_PASSWORD
  TEAM_ID
].freeze
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
  VITE_SENTRY_COMMIT
  VITE_SENTRY_DSN
  VITE_SENTRY_ENVIRONMENT
  VITE_SENTRY_PLATFORM
  VITE_WS_URL
].freeze
NATIVE_STAGING_ENV_NAMES = (
  NATIVE_STAGING_PLATFORM_VITE_ENV_NAMES + NATIVE_SHARED_VITE_ENV_NAMES
).freeze
NATIVE_VITE_ENV_NAMES = (
  NATIVE_SHARED_VITE_ENV_NAMES + NATIVE_STAGING_PLATFORM_VITE_ENV_NAMES + NATIVE_RELEASE_MANAGED_VITE_ENV_NAMES
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

# Vite client settings each file may provide for the selected tier. Production
# reads them from its shared.env only, never the server-oriented prod/app.env.
# Staging takes only explicitly shared settings from its shared.env and only the
# native RevenueCat client settings from its app.env, so production keys and
# unrelated deploy values cannot leak into a staging app.
def native_release_vite_env_names(file_name)
  if NATIVE_RELEASE_TIER == 'staging'
    file_name == 'app.env' ? NATIVE_STAGING_ENV_NAMES : NATIVE_SHARED_VITE_ENV_NAMES
  else
    file_name == 'app.env' ? [] : NATIVE_VITE_ENV_NAMES
  end
end

def warn_ignored_native_vite_names(environment, file_name, allowed_names)
  ignored_names = environment.keys.select do |name|
    name.start_with?('VITE_') && !allowed_names.include?(name)
  end
  return if ignored_names.empty?

  source = "#{NATIVE_RELEASE_TARGET.fetch(:secrets_tier)}/#{file_name}"
  warn "Ignoring #{source} Vite settings for #{NATIVE_RELEASE_TIER}: #{ignored_names.sort.join(', ')}"
end

def native_release_env_file(file_name)
  environment = parsed_native_release_env(File.join(NATIVE_SECRETS_DIR, file_name))
  vite_names = native_release_vite_env_names(file_name)
  warn_ignored_native_vite_names(environment, file_name, vite_names)
  environment.slice(*NATIVE_STORE_ENV_NAMES, *vite_names)
end

# Both files also hold server values no lane needs, so each contributes only
# the allowlisted names; app.env wins over shared.env.
def native_release_file_environment
  native_release_env_file('shared.env').merge(native_release_env_file('app.env'))
end

# Load release values while preserving every variable explicitly set by the
# caller. Parsing first lets app.env override shared.env.
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
# Otherwise the baseline is production's shared.env, whichever tier releases.
def native_release_production_store_key(env_name)
  baseline_name = "NATIVE_RELEASE_PRODUCTION_#{env_name}"
  explicit_baseline = ENV.fetch(baseline_name, '').strip
  return explicit_baseline unless explicit_baseline.empty?

  parsed_native_release_env(NATIVE_PRODUCTION_SHARED_ENV_PATH)[env_name]
end
