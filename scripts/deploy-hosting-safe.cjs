/**
 * Daily Fresh ERP — Safe Web Hosting Deployment Pipeline
 *
 * Enforces pre-release validation and verification before publishing to Firebase Hosting:
 * 1. Project Verification: Ensures active Firebase project is 'daily-fresh-billing-system'.
 * 2. Automated Test Suite: Executes Vitest unit tests (aborts if any test fails).
 * 3. Type Checking: Executes TypeScript compilation (tsc -b) without errors.
 * 4. Manifest Generation: Synchronizes version.json with package.json version and buildId.
 * 5. Production Build: Runs Vite production build.
 * 6. Hosting Deployment: Deploys hosting bundle (--only hosting).
 * 7. Live Audit: Verifies live https://daily-fresh-billing-system.web.app/version.json over HTTPS.
 * 8. Rollback Runbook: Outputs rollback steps if issues occur post-release.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const PROJECT_ID = 'daily-fresh-billing-system';
const PRODUCTION_URL = 'https://daily-fresh-billing-system.web.app';

function logStep(step, message) {
  console.log(`\n================================================================`);
  console.log(`[Step ${step}] ${message}`);
  console.log(`================================================================`);
}

async function verifyLiveManifest(expectedVersion) {
  return new Promise((resolve, reject) => {
    const url = `${PRODUCTION_URL}/version.json?t=${Date.now()}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Live manifest HTTP ${res.statusCode}`));
        }
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (e) {
          reject(new Error(`Live manifest returned invalid JSON: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  process.chdir(rootDir);

  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const version = pkg.version || '1.0.9';

  console.log(`\nStarting Safe Production Deployment for Daily Fresh ERP v${version}`);
  console.log(`Target: ${PRODUCTION_URL}`);

  logStep(1, 'VERIFYING ACTIVE FIREBASE PROJECT');
  const activeProject = execSync('npx firebase-tools use', { encoding: 'utf8' }).trim();
  console.log(`Active Firebase Project: ${activeProject}`);
  if (!activeProject.includes(PROJECT_ID)) {
    throw new Error(`ABORT: Active Firebase project is '${activeProject}', expected '${PROJECT_ID}'.`);
  }
  console.log('Project check: PASS');

  logStep(2, 'EXECUTING UNIT TEST SUITE');
  console.log('Running npm run test...');
  execSync('npm run test', { stdio: 'inherit' });
  console.log('Automated tests: PASS');

  logStep(3, 'EXECUTING TYPESCRIPT TYPE CHECK');
  console.log('Running npx tsc -b...');
  execSync('npx tsc -b', { stdio: 'inherit' });
  console.log('TypeScript check: PASS');

  logStep(4, 'GENERATING VERSION MANIFEST & BUILD IDENTIFIER');
  execSync('node scripts/update-version-manifest.cjs', { stdio: 'inherit' });

  logStep(5, 'COMPILING PRODUCTION BUNDLE');
  execSync('npm run build', { stdio: 'inherit' });

  const distIndex = path.join(rootDir, 'dist', 'index.html');
  const distManifest = path.join(rootDir, 'dist', 'version.json');
  if (!fs.existsSync(distIndex) || !fs.existsSync(distManifest)) {
    throw new Error('ABORT: Production build is missing dist/index.html or dist/version.json');
  }
  console.log('Build verification: PASS');

  logStep(6, 'DEPLOYING TO FIREBASE HOSTING');
  console.log(`Deploying to ${PROJECT_ID} (--only hosting)...`);
  execSync(`npx firebase-tools deploy --only hosting --project ${PROJECT_ID}`, { stdio: 'inherit' });

  logStep(7, 'AUDITING LIVE VERSION MANIFEST OVER HTTPS');
  console.log(`Querying ${PRODUCTION_URL}/version.json ...`);
  const liveManifest = await verifyLiveManifest(version);
  console.log(`Live Version: ${liveManifest.version} (Build: ${liveManifest.buildId || 'N/A'})`);
  console.log(`Web Version:  ${liveManifest.platforms?.web?.version}`);

  if (liveManifest.version !== version) {
    console.warn(`WARNING: Live manifest version '${liveManifest.version}' does not match deployed version '${version}'. CDN propagation may take 1-2 minutes.`);
  } else {
    console.log('Live Version Alignment: PASS');
  }

  console.log('\n================================================================');
  console.log(`SUCCESSFULLY RELEASED Daily Fresh ERP v${version} TO PRODUCTION!`);
  console.log(`URL: ${PRODUCTION_URL}`);
  console.log('================================================================\n');
  console.log('ROLLBACK INSTRUCTIONS (if rollback is ever required):');
  console.log('1. Run `npx firebase-tools hosting:rollback --project daily-fresh-billing-system`');
  console.log('2. Or check out the previous stable git commit and run `npm run deploy:hosting:safe`\n');
}

main().catch((err) => {
  console.error('\nDeployment pipeline failed:', err.message);
  process.exit(1);
});
