// scripts/setupCerts.js
// Sets up locally-trusted HTTPS certificates for the panel using mkcert.
// Run once with: npm run panel:certs

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const cwd = process.cwd();
const certsDir = path.join(cwd, '.certs');
const certFile = path.join(certsDir, 'cert.pem');
const keyFile = path.join(certsDir, 'key.pem');

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

function main() {
  console.log('🔐 Panel HTTPS Certificate Setup\n');

  if (!checkMkcert()) {
    console.error('❌ mkcert is not installed.');
    console.error('   Install it with: brew install mkcert');
    console.error('   Then re-run: npm run panel:certs');
    process.exit(1);
  }

  // Install local CA (trusted by the OS and all browsers on this machine)
  console.log('📋 Installing local Certificate Authority (may prompt for password)...');
  try {
    execSync('mkcert -install', { stdio: 'inherit' });
  } catch (err) {
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
    console.error('\n❌ Failed to generate certificate:', err.message);
    process.exit(1);
  }

  console.log('\n✅ Done! Certificates saved to .certs/');
  console.log('   The panel will now use HTTPS automatically on the next start.\n');
  console.log('🚀 Start the panel with:');
  console.log('   npm run panel\n');
  if (lanIp) {
    const port = process.env.PANEL_PORT || 4100;
    console.log(`📱 LAN access (HTTPS): https://${lanIp}:${port}`);
    console.log('   Browser notifications will work from any device on your network.\n');
  }
  console.log('ℹ️  The .certs/ folder is git-ignored. Run npm run panel:certs again');
  console.log('   if you change networks or the LAN IP changes.\n');
}

main();
