# Capacitor rules
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

# Kotlin Coroutines
-keep class kotlin.coroutines.jvm.internal.SpillingKt { *; }
-dontwarn kotlin.coroutines.jvm.internal.SpillingKt
