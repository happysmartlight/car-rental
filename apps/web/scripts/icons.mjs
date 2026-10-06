// Sinh PNG từ public/icons/icon.svg. Chạy: node apps/web/scripts/icons.mjs
import path from 'node:path';
import sharp from 'sharp';

const dir = path.resolve(import.meta.dirname, '../public/icons');
const svg = path.join(dir, 'icon.svg');
for (const [name, size, pad] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  ['icon-maskable-512.png', 512, 56],
]) {
  const inner = size - pad * 2;
  const img = await sharp(svg).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: pad ? '#2563eb' : { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: img, top: pad, left: pad }])
    .png()
    .toFile(path.join(dir, name));
  console.log('✓', name);
}
