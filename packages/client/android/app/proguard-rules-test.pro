# ProGuard rules for Android instrumented tests running against release build
# Keep all test framework classes
-keep class androidx.test.** { *; }
-keep class org.junit.** { *; }
-keep class junit.** { *; }

# Keep all test classes in the app
-keep class com.tearleads.app.**Test { *; }
-keep class com.tearleads.app.**Test$* { *; }

# Keep test runner
-keep class androidx.test.runner.AndroidJUnitRunner { *; }
-keep class androidx.test.internal.runner.** { *; }

# Prevent obfuscation of test-related annotations
-keepattributes *Annotation*
