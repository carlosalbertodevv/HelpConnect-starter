package com.helpconnect.android.projection

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager

data class ProjectionGrant(val resultCode: Int, val permissionData: Intent)

object ProjectionConsent {
    fun createRequest(manager: MediaProjectionManager): Intent = manager.createScreenCaptureIntent()

    fun accept(resultCode: Int, data: Intent?): ProjectionGrant? {
        if (resultCode != Activity.RESULT_OK || data == null) return null
        return ProjectionGrant(resultCode, data)
    }
}
