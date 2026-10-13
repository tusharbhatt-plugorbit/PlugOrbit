package com.loginapp

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class DeviceToolsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "PlugOrbitDeviceTools"
    private var saving: Promise? = null
    private var pendingPdf: ByteArray? = null
    private val requestCode = 9411
    private var scanning = false
    private val listener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != this@DeviceToolsModule.requestCode) return
            val promise = saving ?: return
            try {
                val uri = data?.data
                if (resultCode != Activity.RESULT_OK || uri == null) {promise.resolve(null); return}
                val bytes = pendingPdf ?: throw IllegalStateException("Receipt content was lost. Try again.")
                val output = context.contentResolver.openOutputStream(uri) ?: throw IllegalStateException("Could not open the selected file.")
                output.use {it.write(bytes)}
                promise.resolve(uri.toString())
            } catch (error: Exception) {promise.reject("RECEIPT_SAVE", "Could not save this receipt. Try another folder.", error)}
            finally {saving = null; pendingPdf = null}
        }
    }
    init {context.addActivityEventListener(listener)}
    override fun invalidate() {context.removeActivityEventListener(listener); saving?.reject("ABORTED", "Receipt save cancelled."); saving = null; pendingPdf = null; super.invalidate()}

    @ReactMethod
    fun scanQr(promise: Promise) {
        val activity = context.currentActivity
        if (activity == null) {promise.reject("CAMERA_ACTIVITY", "Reopen PlugOrbit and try again."); return}
        if (scanning) {promise.reject("SCAN_BUSY", "The QR scanner is already open."); return}
        scanning = true
        activity.runOnUiThread {
            try {
                val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build()
                GmsBarcodeScanning.getClient(activity, options).startScan()
                    .addOnSuccessListener {barcode -> scanning = false; promise.resolve(barcode.rawValue)}
                    .addOnCanceledListener {scanning = false; promise.resolve(null)}
                    .addOnFailureListener {error -> scanning = false; promise.reject("SCAN_UNAVAILABLE", "Could not open the camera scanner. Update Google Play services and retry.", error)}
            } catch (error: Exception) {scanning = false; promise.reject("SCAN_UNAVAILABLE", "Could not open the QR scanner.", error)}
        }
    }

    @ReactMethod
    fun saveReceipt(payload: String, promise: Promise) {
        val activity = context.currentActivity
        if (activity == null) {promise.reject("RECEIPT_ACTIVITY", "Reopen PlugOrbit and try again."); return}
        if (saving != null) {promise.reject("RECEIPT_BUSY", "A receipt save is already open."); return}
        try {
            val receipt = JSONObject(payload)
            val document = PdfDocument()
            try {
                var pageNumber = 1
                var page = document.startPage(PdfDocument.PageInfo.Builder(595, 842, pageNumber).create())
                val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {color = Color.rgb(15, 23, 42); textSize = 12f; typeface = Typeface.create("sans-serif", Typeface.NORMAL)}
                var y = 50f
                paint.textSize = 24f; paint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
                page.canvas.drawText("PlugOrbit", 40f, y, paint); y += 32f
                paint.textSize = 17f; page.canvas.drawText("Charging session receipt", 40f, y, paint); y += 32f
                paint.textSize = 12f; paint.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
                val lines = receipt.getJSONArray("lines")
                for (i in 0 until lines.length()) {
                    var line = lines.getString(i).replace("\r", " ").replace("\n", " ")
                    do {
                        if (y > 780f) {document.finishPage(page); pageNumber++; page = document.startPage(PdfDocument.PageInfo.Builder(595, 842, pageNumber).create()); y = 50f}
                        val count = paint.breakText(line, true, 515f, null).coerceAtLeast(1).coerceAtMost(line.length)
                        page.canvas.drawText(line.take(count), 40f, y, paint); y += 21f
                        line = line.drop(count).trimStart()
                    } while (line.isNotEmpty())
                    y += 8f
                }
                document.finishPage(page)
                val output = ByteArrayOutputStream(); document.writeTo(output); pendingPdf = output.toByteArray()
            } finally {document.close()}
            saving = promise
            val name = receipt.optString("name", "PlugOrbit-receipt").replace(Regex("[^A-Za-z0-9_-]"), "-").take(80)
            activity.runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {addCategory(Intent.CATEGORY_OPENABLE); type = "application/pdf"; putExtra(Intent.EXTRA_TITLE, "$name.pdf")}
                    activity.startActivityForResult(intent, requestCode)
                } catch (error: Exception) {saving = null; pendingPdf = null; promise.reject("RECEIPT_PICKER", "Could not open Files. Install or enable a file manager.", error)}
            }
        } catch (error: Exception) {saving = null; pendingPdf = null; promise.reject("RECEIPT_CREATE", "Could not create this receipt.", error)}
    }
}
class DeviceToolsPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(DeviceToolsModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
