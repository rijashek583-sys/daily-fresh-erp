package com.dailyfresh.erp;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

@CapacitorPlugin(name = "AppUpdatePlugin")
public class AppUpdatePlugin extends Plugin {

    private volatile boolean isCancelled = false;

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            Context context = getContext();
            PackageManager pm = context.getPackageManager();
            PackageInfo pInfo;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pInfo = pm.getPackageInfo(context.getPackageName(), PackageManager.PackageInfoFlags.of(0));
            } else {
                pInfo = pm.getPackageInfo(context.getPackageName(), 0);
            }

            long versionCode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                versionCode = pInfo.getLongVersionCode();
            } else {
                versionCode = pInfo.versionCode;
            }

            JSObject ret = new JSObject();
            ret.put("versionName", pInfo.versionName != null ? pInfo.versionName : "1.0.0");
            ret.put("versionCode", versionCode);
            ret.put("packageName", context.getPackageName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to query installed app version: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        try {
            Context context = getContext();
            boolean canInstall = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                canInstall = context.getPackageManager().canRequestPackageInstalls();
            }
            JSObject ret = new JSObject();
            ret.put("canInstall", canInstall);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to check install permission: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            Context context = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open install permission settings: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        isCancelled = true;
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String downloadUrl = call.getString("downloadUrl");
        if (downloadUrl == null || downloadUrl.trim().isEmpty()) {
            call.reject("Missing downloadUrl parameter");
            return;
        }

        final String expectedSha256 = call.getString("expectedSha256");
        final Long expectedSize = call.hasOption("expectedSizeBytes") ? call.getLong("expectedSizeBytes") : null;

        isCancelled = false;

        new Thread(() -> {
            HttpURLConnection connection = null;
            InputStream inputStream = null;
            FileOutputStream outputStream = null;
            File outputFile = null;

            try {
                Context context = getContext();
                URL url = new URL(downloadUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("User-Agent", "DailyFresh-Android-Updater");
                connection.connect();

                int responseCode = connection.getResponseCode();
                if (responseCode != HttpURLConnection.HTTP_OK && responseCode != HttpURLConnection.HTTP_PARTIAL) {
                    throw new Exception("HTTP server returned error: " + responseCode + " " + connection.getResponseMessage());
                }

                long totalBytes = connection.getContentLengthLong();
                if (totalBytes <= 0 && expectedSize != null && expectedSize > 0) {
                    totalBytes = expectedSize;
                }

                File cacheDir = context.getCacheDir();
                outputFile = new File(cacheDir, "DailyFresh-update.apk");
                if (outputFile.exists()) {
                    outputFile.delete();
                }

                inputStream = connection.getInputStream();
                outputStream = new FileOutputStream(outputFile);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");

                byte[] buffer = new byte[8192];
                long bytesDownloaded = 0;
                int bytesRead;
                int lastReportedPercent = -1;

                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    if (isCancelled) {
                        outputStream.close();
                        if (outputFile.exists()) {
                            outputFile.delete();
                        }
                        call.reject("Update download was cancelled by user.");
                        return;
                    }

                    outputStream.write(buffer, 0, bytesRead);
                    digest.update(buffer, 0, bytesRead);
                    bytesDownloaded += bytesRead;

                    if (totalBytes > 0) {
                        int percent = (int) ((bytesDownloaded * 100) / totalBytes);
                        if (percent != lastReportedPercent && (percent % 2 == 0 || percent == 100)) {
                            lastReportedPercent = percent;
                            JSObject progressData = new JSObject();
                            progressData.put("progress", percent);
                            progressData.put("bytesReceived", bytesDownloaded);
                            progressData.put("totalBytes", totalBytes);
                            notifyListeners("downloadProgress", progressData);
                        }
                    }
                }

                outputStream.flush();
                outputStream.close();
                outputStream = null;

                // Compute SHA-256
                byte[] hashBytes = digest.digest();
                StringBuilder sb = new StringBuilder();
                for (byte b : hashBytes) {
                    sb.append(String.format(Locale.US, "%02X", b));
                }
                String actualSha256 = sb.toString();

                // Verify SHA-256 if provided
                if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
                    if (!actualSha256.equalsIgnoreCase(expectedSha256.trim())) {
                        if (outputFile.exists()) {
                            outputFile.delete();
                        }
                        call.reject("Downloaded APK checksum verification failed! Expected " + expectedSha256 + " but got " + actualSha256);
                        return;
                    }
                }

                // Verify Size if provided
                if (expectedSize != null && expectedSize > 0) {
                    long actualSize = outputFile.length();
                    if (actualSize != expectedSize) {
                        if (outputFile.exists()) {
                            outputFile.delete();
                        }
                        call.reject("Downloaded APK size verification failed! Expected " + expectedSize + " bytes but got " + actualSize + " bytes.");
                        return;
                    }
                }

                // Launch Android Package Installer via FileProvider
                Uri apkUri = FileProvider.getUriForFile(
                        context,
                        context.getPackageName() + ".fileprovider",
                        outputFile
                );

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(installIntent);

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("message", "Package installer opened. Please confirm update on your screen.");
                res.put("filePath", outputFile.getAbsolutePath());
                res.put("sha256", actualSha256);
                call.resolve(res);

            } catch (Exception e) {
                if (outputFile != null && outputFile.exists()) {
                    outputFile.delete();
                }
                call.reject("Update download failed: " + e.getMessage(), e);
            } finally {
                try {
                    if (outputStream != null) outputStream.close();
                } catch (Exception ignored) {}
                try {
                    if (inputStream != null) inputStream.close();
                } catch (Exception ignored) {}
                if (connection != null) connection.disconnect();
            }
        }).start();
    }
}
