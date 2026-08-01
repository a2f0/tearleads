# frozen_string_literal: true

require 'date'
require 'json'
require 'open3'
require 'time'

# Store build numbers default to the PR merged most recently on the release
# date, discovered from GitHub (gh) with local git history as a fallback.
# env_prefix scopes the configuration environment names to a platform
# (ANDROID_RELEASE_* or IOS_RELEASE_*); lane option names are shared.

MERGED_RELEASE_PR_LIST_COMMAND = %w[
  gh pr list --state merged --json number,mergedAt,title --limit 100
].freeze
MERGED_RELEASE_PR_PATTERN = /\(#(?<number>\d+)\)/

def positive_release_integer(value, description)
  number = Integer(value.to_s, 10)
  UI.user_error!("#{description} must be positive.") unless number.positive?

  number
rescue ArgumentError, TypeError
  UI.user_error!("#{description} must be a positive integer: #{value}")
end

def release_command_available?(command)
  system('which', command, out: File::NULL, err: File::NULL)
end

def release_command_output(*command)
  output, status = Open3.capture2e(*command)

  [output, status.success?]
rescue Errno::ENOENT => e
  [e.message, false]
end

def merged_release_pr_merged_at(pull_request)
  Time.parse(pull_request.fetch('mergedAt'))
end

def merged_release_pr_merged_on_date?(pull_request, date)
  merged_release_pr_merged_at(pull_request).localtime.to_date == date
end

def merged_release_date(options, env_prefix)
  env_name = "#{env_prefix}_RELEASE_MERGED_DATE"
  raw_date = lane_option(options, :merged_date, env_name, Date.today.iso8601)

  Date.iso8601(raw_date.to_s)
rescue Date::Error
  UI.user_error!("#{env_name} must be YYYY-MM-DD: #{raw_date}")
end

def configured_merged_release_pr_number(options, env_prefix)
  value = lane_option(options, :merged_pr_number, "#{env_prefix}_RELEASE_MERGED_PR_NUMBER")
  value ||= lane_option(options, :pr_number, "#{env_prefix}_RELEASE_PR_NUMBER")
  return nil if value.nil?

  positive_release_integer(value, 'Merged release PR number')
end

def merged_release_github_prs_output
  output, ok = release_command_output(*MERGED_RELEASE_PR_LIST_COMMAND)

  unless ok
    UI.important("Could not query merged GitHub PRs with gh: #{output.strip}")
    return nil
  end

  output
end

def merged_release_github_prs
  output = merged_release_github_prs_output
  return nil if output.nil?

  pull_requests = JSON.parse(output)
  return pull_requests if pull_requests.is_a?(Array)

  UI.important('Could not parse merged GitHub PRs from gh: expected an array.')
  nil
rescue JSON::ParserError => e
  UI.important("Could not parse merged GitHub PRs from gh: #{e.message}")
  nil
end

def merged_release_github_prs_on_date(pull_requests, date)
  pull_requests.select { |pull_request| merged_release_pr_merged_on_date?(pull_request, date) }
end

def latest_merged_release_pr(pull_requests)
  pull_requests.max_by { |pull_request| merged_release_pr_merged_at(pull_request) }
end

def latest_merged_release_pr_from_github(date)
  return nil unless release_command_available?('gh')

  pull_requests = merged_release_github_prs
  return nil if pull_requests.nil?

  latest_pr = latest_merged_release_pr(merged_release_github_prs_on_date(pull_requests, date))
  return nil if latest_pr.nil?

  UI.message("Using PR ##{latest_pr.fetch('number')} merged at #{latest_pr.fetch('mergedAt')}.")
  positive_release_integer(latest_pr.fetch('number'), 'GitHub merged PR number')
rescue StandardError => e
  UI.important("Could not parse merged GitHub PRs from gh: #{e.message}")
  nil
end

def merged_release_pr_git_log_command(date)
  [
    'git',
    'log',
    "--since=#{date.iso8601} 00:00",
    "--until=#{(date + 1).iso8601} 00:00",
    '--format=%ct%x00%s'
  ]
end

def merged_release_pr_git_log_lines(date)
  output, ok = release_command_output(*merged_release_pr_git_log_command(date))

  unless ok
    UI.important("Could not query local git history for merged PRs: #{output.strip}")
    return nil
  end

  output.lines
end

def merged_release_pr_git_log_entry(line)
  timestamp, subject = line.chomp.split("\0", 2)
  match = subject&.match(MERGED_RELEASE_PR_PATTERN)
  return nil if match.nil?

  [timestamp.to_i, match[:number].to_i]
end

def latest_merged_release_pr_from_git(date)
  lines = merged_release_pr_git_log_lines(date)
  return nil if lines.nil?

  latest_entry = lines.filter_map { |line| merged_release_pr_git_log_entry(line) }.max_by(&:first)
  latest_entry&.last
end

def discovered_merged_release_pr_number(date)
  latest_merged_release_pr_from_github(date) || latest_merged_release_pr_from_git(date)
end

def merged_release_pr_number(options, env_prefix)
  configured_pr_number = configured_merged_release_pr_number(options, env_prefix)
  return configured_pr_number unless configured_pr_number.nil?

  date = merged_release_date(options, env_prefix)
  discovered_pr_number = discovered_merged_release_pr_number(date)
  return discovered_pr_number unless discovered_pr_number.nil?

  UI.user_error!(
    "Could not find a PR merged on #{date}. " \
    "Set #{env_prefix}_RELEASE_PR_NUMBER or pass merged_pr_number:<number>."
  )
end
