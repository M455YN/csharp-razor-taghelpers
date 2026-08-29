const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function main() {
  const root = path.join(__dirname, '..');
  const svg = fs.readFileSync(path.join(root, 'logo.svg'));
  await sharp(svg).resize(256, 256).png().toFile(path.join(root, 'logo.png'));
  console.log('logo.png written (256x256)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
