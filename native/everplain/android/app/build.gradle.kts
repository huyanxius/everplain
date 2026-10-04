plugins { id("com.android.application"); kotlin("android"); kotlin("plugin.serialization"); id("org.jetbrains.kotlin.plugin.compose") }
android {
    namespace = "app.everplain.android"
    compileSdk = 35
    defaultConfig { applicationId = "app.everplain.android"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.1.0"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
    buildFeatures { compose = true }
    compileOptions { isCoreLibraryDesugaringEnabled = true; sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("main").java.srcDir("../../tokens/generated")
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    implementation(project(":core"))
    implementation("io.noties.markwon:core:4.6.2")
    implementation("org.commonmark:commonmark:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-strikethrough:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-tables:0.24.0")
    implementation("io.noties.markwon:ext-strikethrough:4.6.2")
    implementation("io.noties.markwon:ext-tables:4.6.2")
    implementation("io.noties.markwon:ext-tasklist:4.6.2")
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
val syncAvatars by tasks.registering(Copy::class) {
    from("../../tokens/assets") { include("avatars.json") }
    into(layout.buildDirectory.dir("generated/avatarAssets"))
}
android.sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/avatarAssets"))
tasks.named("preBuild") { dependsOn(syncAvatars) }
val syncVisualTestFixtures by tasks.registering(Copy::class) {
    from("../../shared-tests/fixtures") { include("codec.json") }
    into(layout.buildDirectory.dir("generated/testFixtureAssets"))
}
android.sourceSets.getByName("androidTest").assets.srcDir(layout.buildDirectory.dir("generated/testFixtureAssets"))
tasks.matching { it.name == "preDebugAndroidTestBuild" }.configureEach { dependsOn(syncVisualTestFixtures) }
dependencies { androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0") }

configurations.configureEach { exclude(group = "com.atlassian.commonmark") }

val syncMotionAssets by tasks.registering(Copy::class) {
    from("../../tokens/motion") { include("liquid-outlines.json", "motion-parameters.json") }
    into(layout.buildDirectory.dir("generated/avatarAssets"))
}
tasks.named("preBuild") { dependsOn(syncMotionAssets) }

dependencies {
    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
