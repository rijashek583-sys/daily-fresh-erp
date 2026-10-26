$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
Write-Host "Using JAVA_HOME: $env:JAVA_HOME"
Write-Host "Using ANDROID_HOME: $env:ANDROID_HOME"

& .\android\gradlew.bat -p android assembleRelease
if ($LASTEXITCODE -eq 0) {
    if (-not (Test-Path release)) {
        New-Item -ItemType Directory -Path release | Out-Null
    }
    if (-not (Test-Path release\v1.0.12)) {
        New-Item -ItemType Directory -Path release\v1.0.12 | Out-Null
    }
    Copy-Item "android\app\build\outputs\apk\release\DailyFresh.apk" -Destination "release\DailyFresh.apk" -Force
    Copy-Item "android\app\build\outputs\apk\release\DailyFresh.apk" -Destination "release\v1.0.12\DailyFresh.apk" -Force
    Write-Host "SUCCESS: DailyFresh.apk copied to release/DailyFresh.apk and release/v1.0.12/DailyFresh.apk"
} else {
    Write-Error "Gradle build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}
