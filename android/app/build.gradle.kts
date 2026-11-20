import java.net.Inet4Address
import java.net.NetworkInterface

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val sharedApiUrl = providers.gradleProperty("helpconnectApiBaseUrl")
    .orElse(providers.environmentVariable("HELPCONNECT_API_BASE_URL"))
val detectedLanAddress = runCatching {
    NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback }
        .sortedByDescending {
            it.displayName.contains("wi-fi", ignoreCase = true) ||
                it.displayName.contains("wireless", ignoreCase = true)
        }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .firstOrNull {
            it.isSiteLocalAddress && !it.isLoopbackAddress && !it.hostAddress.startsWith("169.254.")
        }
        ?.hostAddress
}.getOrNull()

val emulatorApiUrl = providers.gradleProperty("helpconnectEmulatorApiBaseUrl")
    .orElse(providers.environmentVariable("HELPCONNECT_EMULATOR_API_BASE_URL"))
    .orElse(sharedApiUrl)
    .getOrElse("http://10.0.2.2:3001/api")
val lanApiUrl = providers.gradleProperty("helpconnectLanApiBaseUrl")
    .orElse(providers.environmentVariable("HELPCONNECT_LAN_API_BASE_URL"))
    .orElse(sharedApiUrl)
    .getOrElse(detectedLanAddress?.let { "http://$it:3001/api" } ?: "http://10.0.2.2:3001/api")
fun String.asBuildConfigString(): String =
    "\"" + replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.helpconnect.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.helpconnect.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "EMULATOR_API_BASE_URL", emulatorApiUrl.asBuildConfigString())
        buildConfigField("String", "LAN_API_BASE_URL", lanApiUrl.asBuildConfigString())
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

afterEvaluate {
    tasks.matching { it.name == "assembleRelease" || it.name == "bundleRelease" }.configureEach {
        doFirst {
            require(
                emulatorApiUrl.startsWith("https://") &&
                    lanApiUrl.startsWith("https://") &&
                    !emulatorApiUrl.contains("example.invalid") &&
                    !lanApiUrl.contains("example.invalid")
            ) {
                "Configure URLs HTTPS por helpconnectEmulatorApiBaseUrl e helpconnectLanApiBaseUrl antes de gerar um build release."
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("com.google.android.material:material:1.13.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("io.getstream:stream-webrtc-android:1.3.10")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
