const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeSha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex').toUpperCase();
}

function getFileSize(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.statSync(filePath).size;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function getReleaseDownloadToken(version, platform) {
  const raw = crypto.createHash('sha256').update(`daily-fresh-erp-${version}-${platform}-token`).digest('hex');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = pkg.version || '1.0.9';

  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let buildId = pkg.buildId;
  if (!buildId || !buildId.startsWith(`v${version}-`)) {
    buildId = `v${version}-${dateTag}-r1`;
    pkg.buildId = buildId;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  const publicDir = path.join(rootDir, 'public');
  const existingManifestPath = path.join(publicDir, 'version.json');
  let existingManifest = null;
  if (fs.existsSync(existingManifestPath)) {
    try {
      existingManifest = JSON.parse(fs.readFileSync(existingManifestPath, 'utf8'));
    } catch {
      // ignore
    }
  }

  const versionSpecificDir = path.join(rootDir, 'release', `v${version}`);
  const windowsInstallerPath = fs.existsSync(path.join(versionSpecificDir, 'DailyFresh-Setup.exe'))
    ? path.join(versionSpecificDir, 'DailyFresh-Setup.exe')
    : path.join(rootDir, 'release', 'DailyFresh-Setup.exe');
  const androidApkPath = fs.existsSync(path.join(versionSpecificDir, 'DailyFresh.apk'))
    ? path.join(versionSpecificDir, 'DailyFresh.apk')
    : path.join(rootDir, 'release', 'DailyFresh.apk');

  const windowsSha256 =
    computeSha256(windowsInstallerPath) ||
    existingManifest?.platforms?.windows?.sha256 ||
    '40DA4DA5C2094C14F0EE59C8ED5888A5E87E1533CEEDAC070C1392ACE70AA177';
  const windowsSize =
    getFileSize(windowsInstallerPath) ||
    existingManifest?.platforms?.windows?.fileSizeBytes ||
    113806736;

  const androidSha256 =
    computeSha256(androidApkPath) ||
    existingManifest?.platforms?.android?.sha256 ||
    '74D2B12CFC627AE2B4755D48C2237B0E59BB59B6857FCEA18E876CE9B646D8EA';
  const androidSize =
    getFileSize(androidApkPath) ||
    existingManifest?.platforms?.android?.fileSizeBytes ||
    16921557;

  let androidVersionCode = existingManifest?.platforms?.android?.versionCode || 10;
  const buildGradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
  if (fs.existsSync(buildGradlePath)) {
    const gradleContent = fs.readFileSync(buildGradlePath, 'utf8');
    const match = gradleContent.match(/versionCode\s+(\d+)/);
    if (match) androidVersionCode = parseInt(match[1], 10);
  }

  const releaseNotes = `Daily Fresh ERP v${version}: Production release featuring Division-wise Balance Receivable reports (All / Primary / Bakery), Admin-only Expense Void with mandatory audit trail and active total isolation, and Excel-compatible RFC 4180 CSV exports for Staff Collections and Expenses.`;

  const features = {
    product_sales_report: true,
    division_breakdown: true,
    balance_receivable_report: true,
    daily_billing: true,
    client_ledger: true,
    bulk_ordering: true,
    payments_collection: true,
    staff_management: true,
    client_management: true,
    product_management: true,
    expense_tracker: true,
    expense_void_audit: true,
    csv_exports: true,
    trash_recovery: true,
    app_update_system: true,
    windows_desktop_updater: true,
    android_native_updater: true,
    ...(existingManifest?.features || {}),
  };

  const windowsToken = getReleaseDownloadToken(version, 'windows');
  const androidToken = getReleaseDownloadToken(version, 'android');

  const windowsVersionUrl = `https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2Fv${version}%2FDailyFresh-Setup.exe?alt=media&token=${windowsToken}`;
  const windowsStableUrl = 'https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2FDailyFresh-Setup.exe?alt=media';

  const androidVersionUrl = `https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2Fv${version}%2FDailyFresh.apk?alt=media&token=${androidToken}`;
  const androidStableUrl = 'https://firebasestorage.googleapis.com/v0/b/daily-fresh-billing-system.firebasestorage.app/o/releases%2FDailyFresh.apk?alt=media';

  const manifest = {
    version,
    buildId,
    name: 'Daily Fresh ERP',
    releaseDate: existingManifest?.releaseDate || new Date().toISOString(),
    releaseNotes,
    repository: 'https://github.com/rijashek583-sys/daily-fresh-erp',
    releasesPage: 'https://github.com/rijashek583-sys/daily-fresh-erp/releases',
    features,
    platforms: {
      windows: {
        version,
        downloadUrl: windowsVersionUrl,
        directVersionUrl: windowsVersionUrl,
        stableDownloadUrl: windowsStableUrl,
        downloadToken: windowsToken,
        storagePath: `releases/v${version}/DailyFresh-Setup.exe`,
        fileName: 'DailyFresh-Setup.exe',
        fileSizeBytes: windowsSize,
        fileSizeFormatted: formatBytes(windowsSize),
        sha256: windowsSha256,
        mandatory: true,
      },
      android: {
        version,
        versionCode: androidVersionCode,
        downloadUrl: androidVersionUrl,
        directVersionUrl: androidVersionUrl,
        stableDownloadUrl: androidStableUrl,
        downloadToken: androidToken,
        storagePath: `releases/v${version}/DailyFresh.apk`,
        fileName: 'DailyFresh.apk',
        fileSizeBytes: androidSize,
        fileSizeFormatted: formatBytes(androidSize),
        sha256: androidSha256,
        mandatory: true,
      },
      web: {
        version,
        buildId,
        canonicalUrl: 'https://daily-fresh-billing-system.web.app',
      },
    },
  };

  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const outputPath = path.join(publicDir, 'version.json');
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Also write to dist/version.json if dist/ already exists
  const distDir = path.join(rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    fs.writeFileSync(path.join(distDir, 'version.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }

  console.log(`[Version Manifest] Successfully generated ${outputPath}`);
  console.log(`  Version: ${version} (Build: ${buildId})`);
  console.log(`  Windows: ${windowsSize ? formatBytes(windowsSize) : 'Missing'} (${windowsSha256})`);
  console.log(`  Android: ${androidSize ? formatBytes(androidSize) : 'Missing'} (${androidSha256})`);
}

main();
