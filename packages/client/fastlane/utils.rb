RELEASE_NOTES_SCRIPT = File.expand_path('../scripts/generateReleaseNotes.sh', __dir__).freeze

def generate_release_notes(platform)
  UI.user_error!('ANTHROPIC_API_KEY environment variable is required') unless ENV['ANTHROPIC_API_KEY']
  UI.user_error!("Invalid platform: #{platform}. Must be 'ios' or 'android'") unless %w[ios android].include?(platform)

  UI.message('Generating release notes with AI...')
  notes = `#{RELEASE_NOTES_SCRIPT} #{platform}`.strip
  UI.user_error!('Failed to generate release notes') unless $?.success? && !notes.empty?

  # Clean up AI output: remove carriage returns and collapse multiple newlines
  notes = notes.gsub("\r", '').gsub(/\n{2,}/, "\n")

  UI.success("Generated release notes:\n#{notes}")
  notes
end
