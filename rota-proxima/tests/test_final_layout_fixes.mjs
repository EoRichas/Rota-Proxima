import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../static/', import.meta.url);
const index = fs.readFileSync(new URL('index.html', root), 'utf8');
const css = fs.readFileSync(new URL('final-layout-fixes.css', root), 'utf8');
const mobile = fs.readFileSync(new URL('mobile-access.js', root), 'utf8');

assert.match(index, /final-layout-fixes\.css\?v=final-layout-20260916-1/);
assert.match(index, /mobile-access\.js\?v=ui-20260916-12/);

assert.match(css, /#appShell \.sidebar\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?100dvh/);
assert.match(css, /\.modal\s*\{[\s\S]*?overflow:\s*hidden\s*!important/);
assert.match(css, /\.modal-box\s*\{[\s\S]*?overflow-y:\s*auto\s*!important/);
assert.match(css, /\.route-builder \.sticky-card\s*\{[\s\S]*?position:\s*sticky\s*!important/);
assert.match(css, /cassola-logo-frame > img[\s\S]*?clip-path:\s*inset\(0 0 5\.2% 0\)/);
assert.match(css, /cassola-login-backdrop::after/);

assert.match(mobile, /localStorage\.removeItem\('rota_proxima_sidebar_v1'\)/);
assert.match(mobile, /classList\.remove\('sidebar-collapsed'\)/);

console.log('final layout fixes: sidebar, modal PEV, preview e login aprovados');
