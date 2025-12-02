platform :android do
  desc 'Build debug APK'
  lane :build_debug do
    run_gradle(task: 'assembleDebug')
  end

  desc 'Build release APK'
  lane :build_release do
    run_gradle(task: 'assembleRelease')
  end

  desc 'Build release AAB for Play Store'
  lane :build_aab do
    run_gradle(task: 'bundleRelease')
  end

  desc 'Build and deploy to Play Store internal track'
  lane :deploy_internal do
    build_aab
    upload_to_play_store(
      track: 'internal',
      aab: 'android/app/build/outputs/bundle/release/app-release.aab',
      skip_upload_metadata: true,
      skip_upload_images: true,
      skip_upload_screenshots: true
    )
  end

  desc 'Promote internal to beta'
  lane :promote_to_beta do
    upload_to_play_store(
      track: 'internal',
      track_promote_to: 'beta',
      skip_upload_changelogs: true
    )
  end

  desc 'Promote beta to production'
  lane :promote_to_production do
    upload_to_play_store(
      track: 'beta',
      track_promote_to: 'production',
      skip_upload_changelogs: true
    )
  end

  desc 'Run Android unit tests'
  lane :test do
    run_gradle(task: 'test')
  end

  desc 'Run Android instrumented tests (requires device/emulator)'
  lane :test_instrumented do
    run_gradle(task: 'connectedAndroidTest')
  end

  desc 'Clean build artifacts'
  lane :clean do
    run_gradle(task: 'clean')
  end

  private_lane :run_gradle do |options|
    gradle(
      project_dir: './android',
      task: options[:task]
    )
  end
end
