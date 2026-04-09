const { createServer } = require('http');
const { readFileSync, existsSync, statSync } = require('fs');
const { join, extname } = require('path');

const PORT = process.env.PORT || 8082;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json'
};

createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const file = join(ROOT, url);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`Server running on port ${PORT}`));
