import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

describe('Versioned Release Artifacts & Manifest Integrity', () => {
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, 'public', 'version.json');
  const latestYmlPath = path.join(rootDir, 'release', 'v1.0.12', 'latest.yml');
  const apkPath = path.join(rootDir, 'release', 'v1.0.12', 'DailyFresh.apk');
  const exePath = path.join(rootDir, 'release', 'v1.0.12', 'DailyFresh-Setup.exe');

  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('validates public/version.json exists and has version 1.0.12', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.version).toBe('1.0.12');
    expect(manifest.buildId).toBe('v1.0.12-20261026-r1');
  });

  it('enforces version-specific immutable storage paths and valid download tokens for Android', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const android = manifest.platforms.android;

    expect(android.version).toBe('1.0.12');
    expect(android.versionCode).toBe(12);
    expect(android.storagePath).toBe('releases/v1.0.12/DailyFresh.apk');
    expect(android.downloadToken).toMatch(UUID_V4_REGEX);

    // downloadUrl must reference versioned object and include valid token
    expect(android.downloadUrl).toContain('releases%2Fv1.0.12%2FDailyFresh.apk');
    expect(android.downloadUrl).toContain(`token=${android.downloadToken}`);

    // directVersionUrl must match downloadUrl
    expect(android.directVersionUrl).toBe(android.downloadUrl);

    // stableDownloadUrl preserves the backward-compatible unversioned link
    expect(android.stableDownloadUrl).toBe(
      'https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2FDailyFresh.apk?alt=media'
    );
  });

  it('enforces version-specific immutable storage paths and valid download tokens for Windows', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const windows = manifest.platforms.windows;

    expect(windows.version).toBe('1.0.12');
    expect(windows.storagePath).toBe('releases/v1.0.12/DailyFresh-Setup.exe');
    expect(windows.downloadToken).toMatch(UUID_V4_REGEX);

    // downloadUrl must reference versioned object and include valid token
    expect(windows.downloadUrl).toContain('releases%2Fv1.0.12%2FDailyFresh-Setup.exe');
    expect(windows.downloadUrl).toContain(`token=${windows.downloadToken}`);

    // directVersionUrl must match downloadUrl
    expect(windows.directVersionUrl).toBe(windows.downloadUrl);

    // stableDownloadUrl preserves the backward-compatible unversioned link
    expect(windows.stableDownloadUrl).toBe(
      'https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2FDailyFresh-Setup.exe?alt=media'
    );
  });

  it('verifies Windows latest.yml compatibility with public/version.json', () => {
    expect(fs.existsSync(latestYmlPath)).toBe(true);
    const ymlContent = fs.readFileSync(latestYmlPath, 'utf8');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(ymlContent).toContain('version: 1.0.12');
    expect(ymlContent).toContain('path: DailyFresh-Setup.exe');
    expect(ymlContent).toContain(`size: ${manifest.platforms.windows.fileSizeBytes}`);
  });

  it('verifies exact file sizes and SHA-256 hashes against actual local release artifacts', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Android APK check
    expect(fs.existsSync(apkPath)).toBe(true);
    const actualApkSize = fs.statSync(apkPath).size;
    const actualApkHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(apkPath))
      .digest('hex')
      .toUpperCase();

    expect(actualApkSize).toBe(manifest.platforms.android.fileSizeBytes);
    expect(actualApkHash).toBe(manifest.platforms.android.sha256);
    expect(actualApkHash).toBe('DD772EA14725F3389BAD82661A0FB5DC7F5EF30A90FEE14A0EDAAEFB5E2646DC');

    // Windows Setup check
    expect(fs.existsSync(exePath)).toBe(true);
    const actualExeSize = fs.statSync(exePath).size;
    const actualExeHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(exePath))
      .digest('hex')
      .toUpperCase();

    expect(actualExeSize).toBe(manifest.platforms.windows.fileSizeBytes);
    expect(actualExeHash).toBe(manifest.platforms.windows.sha256);
    expect(actualExeHash).toBe('8C682BE52B7DC9282DB361B8420A0C340121DA5DA9D251C9CD69DA1EB25664AD');
  });

  it('verifies dist/version.json matches public/version.json identically', () => {
    const distManifestPath = path.join(rootDir, 'dist', 'version.json');
    if (fs.existsSync(distManifestPath)) {
      const publicRaw = fs.readFileSync(manifestPath, 'utf8').trim();
      const distRaw = fs.readFileSync(distManifestPath, 'utf8').trim();
      expect(distRaw).toBe(publicRaw);
    }
  });
});
