import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../static/', import.meta.url);
const index = fs.readFileSync(new URL('index.html', root), 'utf8');
const css = fs.readFileSync(new URL('responsive-layout-fix.css', root), 'utf8');
const app = fs.readFileSync(new URL('app.js', root), 'utf8');

const loginFix = index.indexOf('/login-visual-fix.css');
const responsiveFix = index.indexOf('/responsive-layout-fix.css');
assert.ok(loginFix >= 0 && responsiveFix > loginFix, 'a camada responsiva deve ser carregada depois dos estilos de login');
assert.match(css, /\.modal-box\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/);
assert.match(css, /#pevForm \.form-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
assert.match(css, /@media\s*\(max-width:\s*980px\)[\s\S]*?#pevForm \.form-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
assert.match(css, /@media\s*\(max-width:\s*980px\)[\s\S]*?\.app-shell,\s*\.app-shell\.sidebar-collapsed\s*\{[\s\S]*?display:\s*block/);
assert.match(app, /<form id="pevForm" class="modal-box">/);

console.log('responsive layout: modal PEV e navegação adaptativa aprovados');
