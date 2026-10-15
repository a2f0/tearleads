# frozen_string_literal: true

require 'open3'

# Holds an iOS release archive to the Swift package pins committed at HEAD.
# Package.resolved's originHash covers the checkout's absolute path, so no
# committed value matches every machine. With a stale local package cache,
# Xcode's automatic resolution then re-resolves to the newest versions the
# manifests allow and rewrites the pins. The archive also disables automatic
# resolution; this refuses a lockfile that differs from HEAD before or after
# the build, including one a previously rejected build left behind.
class SwiftPackagePins
  class MismatchError < StandardError; end

  def self.verify_around(path, &)
    new(path).verify_around(&)
  end

  def initialize(path)
    @path = path
    @committed = committed_contents
  end

  def verify_around
    verify!('before')
    result = yield
    verify!('after')
    result
  end

  private

  def committed_contents
    stdout, status = Open3.capture2(
      'git', '-C', File.dirname(@path), 'show', "HEAD:./#{File.basename(@path)}", binmode: true
    )
    raise MismatchError, "#{@path} is not committed at HEAD" unless status.success?

    stdout
  end

  def verify!(phase)
    return if File.binread(@path) == @committed

    raise MismatchError,
          "#{@path} differs from HEAD #{phase} the release build; " \
          'refusing an archive built with uncommitted Swift package pins'
  end
end
