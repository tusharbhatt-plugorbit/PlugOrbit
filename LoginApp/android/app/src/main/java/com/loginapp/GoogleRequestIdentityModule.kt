package com.loginapp

import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.uimanager.ViewManager
import java.security.MessageDigest

class GoogleRequestIdentityModule(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
  override fun getName() = "GoogleRequestIdentity"

  @Suppress("DEPRECATION")
  override fun getConstants(): Map<String, Any> {
    val context = reactApplicationContext
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val info = context.packageManager.getPackageInfo(
          context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
      info.signingInfo?.apkContentsSigners
    } else {
      context.packageManager.getPackageInfo(
          context.packageName, PackageManager.GET_SIGNATURES).signatures
    }
    val signature = signatures?.firstOrNull()
        ?: error("Application signing certificate is unavailable")
    val sha1 = MessageDigest.getInstance("SHA-1").digest(signature.toByteArray())
        .joinToString("") { "%02X".format(it.toInt() and 0xff) }
    return mapOf("packageName" to context.packageName, "certificateSha1" to sha1)
  }
}

class GoogleRequestIdentityPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
      listOf(GoogleRequestIdentityModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
