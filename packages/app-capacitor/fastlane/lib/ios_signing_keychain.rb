# frozen_string_literal: true

require 'securerandom'

# Owns an ephemeral Fastlane Match keychain without disturbing caller state.
class IosSigningKeychain
  DEFAULT_LOCK_PATH = File.join(Dir.home, 'Library', 'Keychains', '.symcrypt-release.lock').freeze
  PRESERVED_ENVIRONMENT_KEYS = %w[MATCH_KEYCHAIN_PASSWORD MATCH_READONLY].freeze
  TERMINATION_SIGNALS = %w[HUP INT TERM].freeze

  def self.with_temporary(environment:, setup:, cleanup:, lock_path: DEFAULT_LOCK_PATH, &)
    new(environment, setup, cleanup, lock_path).run(&)
  end

  def initialize(environment, setup, cleanup, lock_path)
    @environment = environment
    @setup = setup
    @cleanup = cleanup
    @lock_path = lock_path
  end

  def run(&block)
    return block.call if caller_keychain?

    with_release_lock { run_temporary(&block) }
  end

  private

  def with_release_lock(&)
    File.open(@lock_path, File::RDWR | File::CREAT, 0o600) do |lock|
      lock.flock(File::LOCK_EX)
      yield
    end
  end

  def run_temporary
    previous_signal_handlers = install_termination_handlers
    prepare
    yield
  ensure
    begin
      finish if @ready
    ensure
      restore_signal_handlers(previous_signal_handlers)
    end
  end

  def install_termination_handlers
    TERMINATION_SIGNALS.to_h do |signal|
      [signal, Signal.trap(signal) { raise SignalException, signal }]
    end
  end

  def restore_signal_handlers(handlers)
    return if handlers.nil?

    handlers.each { |signal, handler| Signal.trap(signal, handler) }
  end

  def caller_keychain?
    !@environment['MATCH_KEYCHAIN_NAME'].to_s.empty?
  end

  def prepare
    capture_environment
    @environment.delete('MATCH_KEYCHAIN_NAME')
    @keychain_name = "symcrypt-fastlane-#{Process.pid}-#{SecureRandom.hex(6)}"
    @keychain_password = SecureRandom.hex(32)
    @environment['MATCH_KEYCHAIN_NAME'] = @keychain_name
    @environment['MATCH_KEYCHAIN_PASSWORD'] = @keychain_password
    @environment['MATCH_READONLY'] = 'true'
    @ready = true
    @setup.call(@keychain_name, @keychain_password)
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
