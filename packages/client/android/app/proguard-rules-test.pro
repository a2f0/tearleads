# ProGuard/R8 rules for Android instrumented tests running against release build
# This file is separate from proguard-rules.pro to avoid bloating the production APK
# with test-only dependencies. See issue #750.

# Disable optimization and obfuscation for test APK to preserve test framework behavior
-dontoptimize
-dontobfuscate

# Keep all test framework classes and their dependencies
-keep class androidx.test.** { *; }
-keep class org.junit.** { *; }
-keep class junit.** { *; }

# Keep test runner and internal classes
-keep class androidx.test.runner.AndroidJUnitRunner { *; }
-keep class androidx.test.internal.** { *; }
-keep class androidx.test.ext.** { *; }
-keep class androidx.test.platform.** { *; }
-keep class androidx.test.core.** { *; }
-keep class androidx.test.services.** { *; }

# Keep all test classes in the app
-keep class com.tearleads.app.**Test { *; }
-keep class com.tearleads.app.**Test$* { *; }
-keep class com.tearleads.app.**InstrumentedTest { *; }
-keep class com.tearleads.app.**InstrumentedTest$* { *; }

# Keep Kotlin stdlib classes required by test runner
-keep class kotlin.jvm.internal.Intrinsics { *; }
-keep class kotlin.** { *; }

# Keep AndroidX tracing classes required by instrumentation runner
-keep class androidx.tracing.** { *; }

# Keep AndroidX core classes used by test instrumentation
-keep class androidx.core.** { *; }

# Keep Google common/utility classes used by test framework
-keep class com.google.common.** { *; }
-keep class com.google.android.** { *; }

# Keep AppComponentFactory and related classes for test app instantiation
-keep class androidx.core.app.AppComponentFactory { *; }
-keep class android.app.AppComponentFactory { *; }

# Prevent obfuscation of test-related annotations
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Keep Hamcrest matchers used by test assertions
-keep class org.hamcrest.** { *; }

# Keep Espresso classes
-keep class androidx.test.espresso.** { *; }

# Keep Android Media support classes for MediaSession tests
# These use the old android.support.v4.media package name but are
# provided by the androidx.media:media artifact
-keep class android.support.v4.media.** { *; }
-keep class android.support.v4.media.session.** { *; }

# Keep the app's MediaSession classes and their dependencies
-keep class com.tearleads.app.MediaSessionController { *; }
-keep class com.tearleads.app.MediaSessionController$* { *; }
-keep class com.tearleads.app.MediaSessionBridgePlugin { *; }
