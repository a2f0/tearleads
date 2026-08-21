# frozen_string_literal: true

require 'securerandom'

# Owns an ephemeral Fastlane Match keychain without disturbing caller state.
class IosSigningKeychain
  PRESERVED_ENVIRONMENT_KEYS = %w[MATCH_KEYCHAIN_PASSWORD MATCH_READONLY].freeze

  def self.with_temporary(environment:, setup:, cleanup:, &)
    new(environment, setup, cleanup).run(&)
  end

  def self.authorization_environment(environment, &resolve_path)
    authorization = {}
    keychain_name = environment['MATCH_KEYCHAIN_NAME'].to_s
    authorization['CODESIGN_LOGIN_KEYCHAIN'] = resolve_path.call(keychain_name) unless keychain_name.empty?
    if environment.key?('MATCH_KEYCHAIN_PASSWORD')
      authorization['CODESIGN_KEYCHAIN_PASSWORD'] = environment.fetch('MATCH_KEYCHAIN_PASSWORD')
    end
    authorization
  end

  def initialize(environment, setup, cleanup)
    @environment = environment
    @setup = setup
    @cleanup = cleanup
  end

  def run
    return yield if caller_keychain?

    prepare
    yield
  ensure
    finish if @ready
  end

  private

  def caller_keychain?
    !@environment['MATCH_KEYCHAIN_NAME'].to_s.empty?
  end

  def prepare
    capture_environment
    @environment.delete('MATCH_KEYCHAIN_NAME')
    @keychain_name = "symcrypt-fastlane-#{Process.pid}-#{SecureRandom.hex(6)}"
    @ready = true
    @setup.call(@keychain_name)
  end

  def capture_environment
    @original_environment = {}
    PRESERVED_ENVIRONMENT_KEYS.each do |key|
      @original_environment[key] = @environment[key] if @environment.key?(key)
    end
  end

  def finish
    @cleanup.call(@keychain_name)
  ensure
    @environment.delete('MATCH_KEYCHAIN_NAME')
    restore_environment
  end

  def restore_environment
    PRESERVED_ENVIRONMENT_KEYS.each do |key|
      if @original_environment.key?(key)
        @environment[key] = @original_environment[key]
      else
        @environment.delete(key)
      end
    end
  end
end
