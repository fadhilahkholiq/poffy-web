import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source directory: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source file: ${src}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

copyFile(
  path.join(rootDir, 'node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  path.join(rootDir, 'public/fonts/Inter-Regular.ttf')
);

copyDir(
  path.join(rootDir, 'node_modules/pdfjs-dist/cmaps'),
  path.join(rootDir, 'public/pdfjs/cmaps')
);

copyDir(
  path.join(rootDir, 'node_modules/pdfjs-dist/standard_fonts'),
  path.join(rootDir, 'public/pdfjs/standard_fonts')
);

copyDir(
  path.join(rootDir, 'node_modules/pdfjs-dist/wasm'),
  path.join(rootDir, 'public/pdfjs/wasm')
);

console.log('Synced Inter-Regular.ttf and pdfjs-dist offline assets into public/.');
