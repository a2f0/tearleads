# frozen_string_literal: true

require 'securerandom'

# Owns an ephemeral Fastlane Match keychain without disturbing caller state.
class IosSigningKeychain
  def self.with_temporary(environment:, setup:, cleanup:, &)
    new(environment, setup, cleanup).run(&)
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
    @setup.call(@keychain_name)
    @ready = true
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
