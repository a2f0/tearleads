# ProGuard/R8 rules for Android instrumented tests running against release build
# This file is separate from proguard-rules.pro to avoid bloating the production APK
# with test-only dependencies. See issue #750.

# Disable optimization for test APK to preserve test framework behavior
-dontoptimize

# Keep all test framework classes and their dependencies
-keep class androidx.test.** { *; }
-keep class org.junit.** { *; }
-keep class junit.** { *; }

# Keep test runner and internal classes
-keep class androidx.test.runner.AndroidJUnitRunner { *; }
-keep class androidx.test.internal.runner.** { *; }
-keep class androidx.test.ext.junit.runners.** { *; }

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

# Prevent obfuscation of test-related annotations
-keepattributes *Annotation*

# Keep Hamcrest matchers used by test assertions
-keep class org.hamcrest.** { *; }
