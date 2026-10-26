const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');

const versionJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'public', 'version.json'), 'utf8'));
const EXPECTED_SIZE = versionJson.platforms.windows.fileSizeBytes;
const EXPECTED_SHA256 = versionJson.platforms.windows.sha256;
const BUCKET = 'daily-fresh-billing-system.firebasestorage.app';
const OBJECT_NAME = 'releases/DailyFresh-Setup.exe';

async function getAccessToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Firebase CLI configuration not found. Please run "firebase login"');
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tokens = config.tokens;
  if (!tokens) {
    throw new Error('No tokens found in Firebase CLI config.');
  }

  // If token is reasonably fresh, return it
  if (tokens.expires_at && tokens.expires_at > Date.now() + 60000 && tokens.access_token) {
    return tokens.access_token;
  }

  // If refresh token exists, refresh it
  if (tokens.refresh_token) {
    console.log('Refreshing Firebase access token via Google OAuth...');
    let clientId = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
    let clientSecret = '';
    try {
      const npxPath = path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx');
      if (fs.existsSync(npxPath)) {
        for (const dir of fs.readdirSync(npxPath)) {
          const cand = path.join(npxPath, dir, 'node_modules', 'firebase-tools', 'lib', 'api.js');
          if (fs.existsSync(cand)) {
            const api = require(cand);
            clientId = api.clientId();
            clientSecret = api.clientSecret();
            break;
          }
        }
      }
    } catch {}

    const postParams = {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    };
    if (clientSecret) postParams.client_secret = clientSecret;

    const postData = new URLSearchParams(postParams).toString();

    const refreshed = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'oauth2.googleapis.com',
          path: '/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              return reject(new Error(`Token refresh failed HTTP ${res.statusCode}: ${body}`));
            }
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    if (refreshed.access_token) {
      tokens.access_token = refreshed.access_token;
      if (refreshed.expires_in) {
        tokens.expires_at = Date.now() + refreshed.expires_in * 1000;
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      return refreshed.access_token;
    }
  }

  if (tokens.access_token) return tokens.access_token;
  throw new Error('Unable to obtain a valid access token.');
}

function getReleaseDownloadToken(version, platform) {
  const raw = crypto.createHash('sha256').update(`daily-fresh-erp-${version}-${platform}-token`).digest('hex');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

async function uploadSimpleFile(filePath, remoteName, contentType, token, accessToken) {
  if (!fs.existsSync(filePath)) return null;
  const fileBuf = fs.readFileSync(filePath);
  const metadata = {
    name: remoteName,
    contentType,
  };
  if (token) {
    metadata.metadata = { firebaseStorageDownloadTokens: token };
  }
  return new Promise((resolve, reject) => {
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody = Buffer.concat([
      Buffer.from(delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + delimiter + `Content-Type: ${contentType}\r\n\r\n`),
      fileBuf,
      Buffer.from(closeDelimiter),
    ]);

    const req = https.request({
      hostname: 'storage.googleapis.com',
      path: `/upload/storage/v1/b/${BUCKET}/o?uploadType=multipart&name=${encodeURIComponent(remoteName)}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': multipartBody.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data, status: res.statusCode });
          }
        } else {
          reject(new Error(`Failed to upload ${remoteName}: HTTP ${res.statusCode} ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(multipartBody);
    req.end();
  });
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const targetVersion = versionJson.version || '1.0.12';
  const args = process.argv.slice(2);
  const isStable = args.includes('--stable');

  const objectName = isStable
    ? 'releases/DailyFresh-Setup.exe'
    : (versionJson.platforms?.windows?.storagePath || `releases/v${targetVersion}/DailyFresh-Setup.exe`);

  const versionSpecificExe = path.join(rootDir, 'release', `v${targetVersion}`, 'DailyFresh-Setup.exe');
  const exePath = fs.existsSync(versionSpecificExe) ? versionSpecificExe : path.join(rootDir, 'release', 'DailyFresh-Setup.exe');

  console.log('====================================================');
  console.log(`Daily Fresh ERP — Windows v${targetVersion} Installer Upload`);
  console.log(`Mode: ${isStable ? 'STABLE_ALIAS (releases/DailyFresh-Setup.exe)' : `VERSIONED (${objectName})`}`);
  console.log('====================================================');
  console.log(`Local installer file: ${exePath}`);
  console.log(`Target Object:        ${objectName}`);

  if (!fs.existsSync(exePath)) {
    console.error(`FATAL: File not found: ${exePath}`);
    process.exit(1);
  }

  const stat = fs.statSync(exePath);
  const fileSize = stat.size;

  console.log('\n--- 1. PRE-UPLOAD INTEGRITY CHECK ---');
  console.log(`Expected size:   ${EXPECTED_SIZE} bytes`);
  console.log(`Actual size:     ${fileSize} bytes`);
  if (fileSize !== EXPECTED_SIZE) {
    console.error(`FAILED: File size mismatch (${fileSize} !== ${EXPECTED_SIZE})`);
    process.exit(1);
  }
  console.log('File size check: PASS');

  const localSha256 = await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(exePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
    stream.on('error', reject);
  });

  console.log(`Expected SHA256: ${EXPECTED_SHA256}`);
  console.log(`Actual SHA256:   ${localSha256}`);
  if (localSha256 !== EXPECTED_SHA256) {
    console.error(`FAILED: SHA-256 hash mismatch!`);
    process.exit(1);
  }
  console.log('SHA-256 check:   PASS');

  // Authenticate
  console.log('\n--- 2. AUTHENTICATION ---');
  const accessToken = await getAccessToken();
  console.log('Firebase Storage access token acquired.');

  // Check existing metadata if any
  console.log('\n--- 3. CHECKING EXISTING OBJECT METADATA ---');
  let existingToken = null;
  try {
    const metaCheck = await new Promise((resolve, reject) => {
      https
        .get(
          `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectName)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              if (res.statusCode === 200) {
                try {
                  resolve(JSON.parse(data));
                } catch {
                  resolve(null);
                }
              } else {
                resolve(null);
              }
            });
          }
        )
        .on('error', () => resolve(null));
    });
    if (metaCheck?.metadata?.firebaseStorageDownloadTokens) {
      existingToken = metaCheck.metadata.firebaseStorageDownloadTokens;
      console.log(`Preserving existing download token: ${existingToken}`);
    }
  } catch (err) {
    console.log('No previous metadata found, will create fresh.');
  }

  const downloadToken = isStable
    ? existingToken
    : (versionJson.platforms?.windows?.downloadToken || existingToken || getReleaseDownloadToken(targetVersion, 'windows'));
  console.log(`Using Download Token: ${downloadToken || '(none)'}`);

  // Resumable upload session
  console.log('\n--- 4. INITIATING GCS RESUMABLE UPLOAD ---');
  const metadataObj = {
    name: objectName,
    contentType: 'application/vnd.microsoft.portable-executable',
    contentDisposition: "attachment; filename*=utf-8''DailyFresh-Setup.exe",
  };
  if (downloadToken) {
    metadataObj.metadata = { firebaseStorageDownloadTokens: downloadToken };
  }

  const metadata = JSON.stringify(metadataObj);

  const sessionOptions = {
    hostname: 'storage.googleapis.com',
    path: `/upload/storage/v1/b/${BUCKET}/o?uploadType=resumable&name=${encodeURIComponent(objectName)}`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'Content-Length': Buffer.byteLength(metadata),
      'X-Upload-Content-Type': 'application/vnd.microsoft.portable-executable',
      'X-Upload-Content-Length': fileSize,
    },
  };

  const uploadUrl = await new Promise((resolve, reject) => {
    const req = https.request(sessionOptions, (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        let errData = '';
        res.on('data', (c) => (errData += c));
        res.on('end', () => reject(new Error(`Session init failed HTTP ${res.statusCode}: ${errData}`)));
        return;
      }
      const loc = res.headers['location'];
      if (!loc) return reject(new Error('No location header returned'));
      resolve(loc);
    });
    req.on('error', reject);
    req.write(metadata);
    req.end();
  });

  console.log('Resumable upload session created.');

  // Upload file stream
  console.log(`\n--- 5. STREAMING INSTALLER TO FIREBASE STORAGE (${(fileSize / (1024 * 1024)).toFixed(2)} MB) ---`);
  const parsedUrl = new URL(uploadUrl);
  const uploadOptions = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'PUT',
    headers: {
      'Content-Length': fileSize,
      'Content-Type': 'application/vnd.microsoft.portable-executable',
    },
  };

  const uploadResult = await new Promise((resolve, reject) => {
    const req = https.request(uploadOptions, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data, status: res.statusCode });
          }
        } else {
          reject(new Error(`Upload failed HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);

    let bytesSent = 0;
    const stream = fs.createReadStream(exePath, { highWaterMark: 2 * 1024 * 1024 });
    stream.on('data', (chunk) => {
      bytesSent += chunk.length;
      const pct = ((bytesSent / fileSize) * 100).toFixed(1);
      process.stdout.write(`\rProgress: ${pct}% (${(bytesSent / 1024 / 1024).toFixed(1)} MB / ${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
    });
    stream.pipe(req);
  });

  console.log('\nUpload successfully completed on storage server.');
  console.log(`Object:  ${uploadResult.name}`);
  console.log(`Size:    ${uploadResult.size} bytes`);
  console.log(`Updated: ${uploadResult.updated}`);

  // Upload companion update metadata (latest.yml and blockmap)
  const remoteDir = isStable ? 'releases' : `releases/v${targetVersion}`;
  const latestYmlPath = path.join(path.dirname(exePath), 'latest.yml');
  const blockmapPath = path.join(path.dirname(exePath), 'DailyFresh-Setup.exe.blockmap');

  if (fs.existsSync(latestYmlPath)) {
    console.log(`\nUploading companion update manifest: ${remoteDir}/latest.yml`);
    await uploadSimpleFile(latestYmlPath, `${remoteDir}/latest.yml`, 'text/yaml; charset=utf-8', downloadToken, accessToken);
    console.log(`Uploaded ${remoteDir}/latest.yml successfully.`);
  }

  if (fs.existsSync(blockmapPath)) {
    console.log(`Uploading companion blockmap: ${remoteDir}/DailyFresh-Setup.exe.blockmap`);
    await uploadSimpleFile(blockmapPath, `${remoteDir}/DailyFresh-Setup.exe.blockmap`, 'application/octet-stream', downloadToken, accessToken);
    console.log(`Uploaded ${remoteDir}/DailyFresh-Setup.exe.blockmap successfully.`);
  }

  // Post-upload public HTTPS download verification
  const publicUrl = downloadToken
    ? `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectName)}?alt=media&token=${downloadToken}`
    : `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectName)}?alt=media`;
  console.log('\n--- 6. POST-UPLOAD LIVE HTTPS AUDIT ---');
  console.log(`Testing public download from:\n${publicUrl}`);

  const remoteVerification = await new Promise((resolve, reject) => {
    https
      .get(publicUrl, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Public download returned HTTP ${res.statusCode}`));
        }
        let bytes = 0;
        const hash = crypto.createHash('sha256');
        res.on('data', (c) => {
          bytes += c.length;
          hash.update(c);
        });
        res.on('end', () => {
          resolve({
            size: bytes,
            sha256: hash.digest('hex').toUpperCase(),
          });
        });
        res.on('error', reject);
      })
      .on('error', reject);
  });

  console.log(`Downloaded size:   ${remoteVerification.size} bytes`);
  console.log(`Downloaded SHA256: ${remoteVerification.sha256}`);

  const sizePass = remoteVerification.size === EXPECTED_SIZE;
  const hashPass = remoteVerification.sha256 === EXPECTED_SHA256;

  console.log('\n--- AUDIT RESULTS ---');
  console.log(`Remote Size Match:   ${sizePass ? 'PASS' : 'FAIL'}`);
  console.log(`Remote SHA256 Match: ${hashPass ? 'PASS' : 'FAIL'}`);

  if (!sizePass || !hashPass) {
    console.error('FATAL: Remote installer verification failed!');
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log('SUCCESS: Windows v1.0.6 installer is live and verified.');
  console.log('====================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nExecution failed:', err);
  process.exit(1);
});
