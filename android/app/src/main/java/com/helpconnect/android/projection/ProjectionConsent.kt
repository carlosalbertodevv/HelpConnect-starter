package com.helpconnect.android.projection

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager

data class ProjectionGrant(val resultCode: Int, val permissionData: Intent)

object ProjectionConsent {
    fun createRequest(manager: MediaProjectionManager): Intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            manager.createScreenCaptureIntent(
                MediaProjectionConfig.createConfigForDefaultDisplay()
            )
        } else {
            manager.createScreenCaptureIntent()
        }

    fun accept(resultCode: Int, data: Intent?): ProjectionGrant? {
        if (resultCode != Activity.RESULT_OK || data == null) return null
        return ProjectionGrant(resultCode, data)
    }
}
