import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const password = process.stdin.isTTY
  ? await new Promise(async resolve => {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({input: process.stdin, output: process.stderr});
      try { resolve(await rl.question('Enter strong admin password (visible; clear terminal history): ')); }
      finally {rl.close();}
    })
  : readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (password.length < 18 || password.length > 200) {
  console.error('Password must be between 18 and 200 characters.');
  process.exitCode = 1;
} else {
  // Cloudflare production PBKDF2 max iterations per invocation.
  const rounds = 100000;
  const salt = randomBytes(24);
  const digest = pbkdf2Sync(password, salt, rounds, 32, 'sha256');
  console.log(`pbkdf2_sha256$${rounds}$${salt.toString('base64')}$${digest.toString('base64')}`);
  console.error('Paste the entire single output line into Cloudflare secret ADMIN_PASSWORD_HASH. Never add it to GitHub.');
}
