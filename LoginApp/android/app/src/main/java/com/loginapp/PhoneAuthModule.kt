package com.loginapp

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.google.firebase.FirebaseException
import com.google.firebase.auth.*
import java.util.UUID
import java.util.concurrent.TimeUnit

class PhoneAuthModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "PlugOrbitPhoneAuth"
    private var requestId = ""
    private var verificationId: String? = null
    private var instantCredential: PhoneAuthCredential? = null
    private var sentAt = 0L
    private var lastPhone = ""
    private var pendingSend: Promise? = null
    private var resendToken: PhoneAuthProvider.ForceResendingToken? = null

    private fun fail(promise: Promise, error: Exception) {
        val code = (error as? FirebaseAuthException)?.errorCode ?: "PHONE_AUTH_FAILED"
        promise.reject(code, error.message ?: "Phone verification could not finish.")
    }

    @ReactMethod
    fun sendCode(phone: String, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) { promise.reject("PHONE_ACTIVITY", "Reopen PlugOrbit and try again."); return }
        if (!Regex("^\\+[1-9][0-9]{6,14}$").matches(phone)) {
            promise.reject("PHONE_INVALID", "Enter a valid phone number with country code."); return
        }
        if (phone == lastPhone && System.currentTimeMillis() - sentAt < 30000) {
            promise.reject("PHONE_RATE_LIMITED", "Please wait 30 seconds before requesting another code."); return
        }
        pendingSend?.reject("ABORTED", "Verification cancelled.")
        pendingSend = promise
        requestId = UUID.randomUUID().toString()
        val activeRequest = requestId
        verificationId = null
        instantCredential = null
        var answered = false
        activity.runOnUiThread {
            try {
                val builder = PhoneAuthOptions.newBuilder(FirebaseAuth.getInstance())
                    .setPhoneNumber(phone).setTimeout(60L, TimeUnit.SECONDS).setActivity(activity)
                    .setCallbacks(object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                        override fun onVerificationCompleted(credential: PhoneAuthCredential) {
                            if (requestId != activeRequest) return
                            instantCredential = credential
                            if (!answered) {
                                answered = true
                                pendingSend = null
                                lastPhone = phone; sentAt = System.currentTimeMillis()
                                promise.resolve(Arguments.createMap().apply { putBoolean("instant", true) })
                            }
                        }
                        override fun onVerificationFailed(error: FirebaseException) {
                            if (requestId != activeRequest || answered) return
                            answered = true; pendingSend = null; fail(promise, error)
                        }
                        override fun onCodeSent(id: String, token: PhoneAuthProvider.ForceResendingToken) {
                            if (requestId != activeRequest || answered) return
                            verificationId = id
                            resendToken = token
                            pendingSend = null
                            lastPhone = phone; sentAt = System.currentTimeMillis()
                            answered = true
                            promise.resolve(Arguments.createMap().apply { putBoolean("instant", false) })
                        }
                        override fun onCodeAutoRetrievalTimeOut(id: String) {
                            if (requestId == activeRequest) {
                                verificationId = id
                                if (!answered) {answered = true; pendingSend = null; promise.reject("PHONE_TIMEOUT", "Phone verification timed out. Please try again.")}
                            }
                        }
                    })
                if (phone == lastPhone) resendToken?.let { builder.setForceResendingToken(it) }
                PhoneAuthProvider.verifyPhoneNumber(builder.build())
            } catch (error: Exception) { if (!answered) {answered = true; pendingSend = null; fail(promise, error)} }
        }
    }

    @ReactMethod
    fun verifyCode(code: String, promise: Promise) {
        val credential = instantCredential ?: verificationId?.let { PhoneAuthProvider.getCredential(it, code) }
        if (credential == null) {promise.reject("OTP_EXPIRED", "Request a new verification code."); return}
        FirebaseAuth.getInstance().signInWithCredential(credential).addOnCompleteListener { task ->
            if (!task.isSuccessful) {fail(promise, task.exception ?: Exception("Verification failed")); return@addOnCompleteListener}
            val user = task.result.user
            if (user == null) {promise.reject("PHONE_AUTH_FAILED", "Phone session is unavailable."); return@addOnCompleteListener}
            verificationId = null; instantCredential = null
            answerSession(user, promise)

        }
    }

    private fun answerSession(user: FirebaseUser, promise: Promise) {
        user.getIdToken(true).addOnCompleteListener { task ->
            if (!task.isSuccessful) {fail(promise, task.exception ?: Exception("Token unavailable")); return@addOnCompleteListener}
            val token = task.result.token
            if (token == null) {promise.reject("PHONE_AUTH_FAILED", "Phone session is unavailable."); return@addOnCompleteListener}
            promise.resolve(Arguments.createMap().apply {
                putString("uid", user.uid); putString("idToken", token)
                putDouble("expiresAt", task.result.expirationTimestamp.toDouble() * 1000.0)
            })
        }
    }

    @ReactMethod
    fun getSession(expectedUid: String, promise: Promise) {
        val user = FirebaseAuth.getInstance().currentUser
        if (user == null || user.uid != expectedUid) {promise.reject("AUTH_LOST", "Please sign in again."); return}
        answerSession(user, promise)
    }

    @ReactMethod
    fun signOut(promise: Promise) {FirebaseAuth.getInstance().signOut(); promise.resolve(null)}

    @ReactMethod
    fun cancel(promise: Promise) {
        pendingSend?.reject("ABORTED", "Verification cancelled."); pendingSend = null
        requestId = UUID.randomUUID().toString(); verificationId = null; instantCredential = null
        promise.resolve(null)
    }
}

class PhoneAuthPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PhoneAuthModule(context), DeviceToolsModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
