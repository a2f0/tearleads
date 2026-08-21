# frozen_string_literal: true

require 'securerandom'

# Owns an ephemeral Fastlane Match keychain without disturbing caller state.
class IosSigningKeychain
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
    capture_password
    @environment.delete('MATCH_KEYCHAIN_NAME')
    @keychain_name = "symcrypt-fastlane-#{Process.pid}-#{SecureRandom.hex(6)}"
    @ready = true
    @setup.call(@keychain_name)
  end

  def capture_password
    @had_password = @environment.key?('MATCH_KEYCHAIN_PASSWORD')
    @password = @environment['MATCH_KEYCHAIN_PASSWORD']
  end

  def finish
    @cleanup.call(@keychain_name)
  ensure
    @environment.delete('MATCH_KEYCHAIN_NAME')
    restore_password
  end

  def restore_password
    return @environment['MATCH_KEYCHAIN_PASSWORD'] = @password if @had_password

    @environment.delete('MATCH_KEYCHAIN_PASSWORD')
  end
end
