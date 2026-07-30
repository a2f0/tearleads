# frozen_string_literal: true

# Returns why a generated capacitor.config.json is not a shippable release
# config, or nil when it matches the expected app identity and is fully bundled.
# `cap run --live-reload` leaves server.url pointing the WebView at a LAN dev
# server; the tier-specific sync command restores the expected app ID and a
# bundled WebView configuration.
#
# CapacitorHttp remains enabled in every build because native HTTP lets the
# release WebView reach the API. It is not a debug-leftover signal; a wrong app
# ID or a stray server.url is.
def capacitor_release_problem(config, expected_app_identifier)
  app_identifier = config['appId'].to_s
  unless app_identifier == expected_app_identifier
    return "sets appId=#{app_identifier.inspect} instead of #{expected_app_identifier.inspect}"
  end

  server_url = config.dig('server', 'url').to_s
  return "sets server.url=#{server_url} (usually a leftover live-reload URL)" unless server_url.empty?

  nil
end
