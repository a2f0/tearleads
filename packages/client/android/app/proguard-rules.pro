# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Capacitor rules (also included via consumerProguardFiles from capacitor-android)
-keep public class * extends com.getcapacitor.BridgeActivity
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}

# Keep JavaScript interface for WebView
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve line numbers for debugging stack traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Google Tink / SQLCipher - suppress warnings for compile-time annotations
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.Nullable
-dontwarn javax.annotation.concurrent.GuardedBy

# Kotlin Coroutines - keep SpillingKt class used by Capacitor Filesystem plugin
-keep class kotlin.coroutines.jvm.internal.SpillingKt { *; }
-dontwarn kotlin.coroutines.jvm.internal.SpillingKt

# Keep Kotlin stdlib classes used by AndroidX test runner in release instrumentation
-keep class kotlin.jvm.internal.Intrinsics { *; }
-keep class kotlin.** { *; }

# Keep AndroidX tracing classes required by instrumentation runner
-keep class androidx.tracing.** { *; }
