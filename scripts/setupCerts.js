// scripts/setupCerts.js
// Sets up locally-trusted HTTPS certificates for the panel using mkcert.
//
// Manual run:  npm run panel:certs
// Auto mode:   node scripts/setupCerts.js --auto
//   In auto mode the script is non-blocking:
//   - Skips silently if certs already exist.
//   - Skips with a hint (exit 0) if mkcert is not installed.
//   - Generates certs (may prompt for CA password once) if mkcert is available.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const cwd = process.cwd();
const certsDir = path.join(cwd, '.certs');
const certFile = path.join(certsDir, 'cert.pem');
const keyFile = path.join(certsDir, 'key.pem');
const isAuto = process.argv.includes('--auto');

function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function checkMkcert() {
  try {
    execSync('which mkcert', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function certsExist() {
  return fs.existsSync(certFile) && fs.existsSync(keyFile);
}

function main() {
  // Auto mode: skip if certs are already present
  if (isAuto && certsExist()) {
    return;
  }

  if (!isAuto) {
    console.log('🔐 Panel HTTPS Certificate Setup\n');
  }

  if (!checkMkcert()) {
    if (isAuto) {
      console.log('ℹ️  mkcert not found — panel will start with plain HTTP.');
      console.log('   Run "brew install mkcert && npm run panel:certs" for HTTPS + LAN notifications.');
      return; // exit 0, don't block panel startup
    }
    console.error('❌ mkcert is not installed.');
    console.error('   Install it with: brew install mkcert');
    console.error('   Then re-run: npm run panel:certs');
    process.exit(1);
  }

  if (isAuto) {
    console.log('🔐 Generating HTTPS certificates for the panel...');
  }

  // Install local CA (trusted by the OS and all browsers on this machine)
  console.log('📋 Installing local Certificate Authority (may prompt for password)...');
  try {
    execSync('mkcert -install', { stdio: 'inherit' });
  } catch (err) {
    if (isAuto) {
      console.warn(`⚠️  mkcert -install failed: ${err.message}`);
      console.warn('   Panel will start with plain HTTP.');
      return;
    }
    console.error('\n❌ Failed to install CA:', err.message);
    process.exit(1);
  }

  // Ensure certs directory exists
  fs.mkdirSync(certsDir, { recursive: true });

  // Build list of hosts to include in the certificate
  const hosts = ['localhost', '127.0.0.1'];
  const lanIp = getLocalNetworkIp();
  if (lanIp) {
    hosts.push(lanIp);
    console.log(`\n📱 LAN IP detected: ${lanIp} — including in certificate.`);
  } else {
    console.log('\n⚠️  Could not detect LAN IP. Certificate will cover localhost only.');
  }

  // Generate certificate
  console.log(`\n📜 Generating certificate for: ${hosts.join(', ')}`);
  const hostArgs = hosts.join(' ');
  try {
    execSync(
      `mkcert -cert-file "${certFile}" -key-file "${keyFile}" ${hostArgs}`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    if (isAuto) {
      console.warn(`⚠️  Certificate generation failed: ${err.message}`);
      console.warn('   Panel will start with plain HTTP.');
      return;
    }
    console.error('\n❌ Failed to generate certificate:', err.message);
    process.exit(1);
  }

  if (isAuto) {
    console.log('\n✅ HTTPS certificates ready. Panel will start with HTTPS.');
    return;
  }

  console.log('\n✅ Done! Certificates saved to .certs/');
  console.log('   The panel will now use HTTPS automatically on the next start.\n');
  if (lanIp) {
    const port = process.env.PANEL_PORT || 4100;
    console.log(`📱 LAN access (HTTPS): https://${lanIp}:${port}`);
    console.log('   Browser notifications will work from any device on your network.\n');
  }
  console.log('ℹ️  The .certs/ folder is git-ignored. Run npm run panel:certs again');
  console.log('   if you change networks or the LAN IP changes.\n');
}

main();
