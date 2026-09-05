import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const brand = join(root, "public", "brand");
const sizes = [16, 32, 48, 64, 128, 180, 192, 512];

for (const theme of ["dark", "light", "white", "black"]) {
  await sharp(join(brand, `wordmark-${theme}.svg`))
    .resize(1000, 360, { kernel: "nearest" })
    .png()
    .toFile(join(brand, `wordmark-${theme}.png`));
}

for (const theme of ["dark", "light"]) {
  for (const size of sizes) {
    await sharp(join(brand, `icon-${theme}.svg`))
      .resize(size, size, { kernel: "nearest" })
      .png()
      .toFile(join(brand, `icon-${theme}-${size}.png`));
  }
}

// ICO directory entries point to PNG frames, retaining the exact small-size pixels.
const faviconSizes = [16, 32, 48];
const frames = await Promise.all(faviconSizes.map((size) => readFile(join(brand, `icon-dark-${size}.png`))));
const directory = Buffer.alloc(6 + frames.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
for (const [index, frame] of frames.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = faviconSizes[index];
  directory[entry + 1] = faviconSizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
}
await writeFile(join(brand, "favicon.ico"), Buffer.concat([directory, ...frames]));
await copyFile(join(brand, "favicon.ico"), join(root, "app", "favicon.ico"));

await sharp(join(brand, "icon-dark.svg"))
  .resize(180, 180, { kernel: "nearest" })
  .flatten({ background: "#151515" })
  .png()
  .toFile(join(brand, "apple-touch-icon.png"));
await copyFile(join(brand, "apple-touch-icon.png"), join(root, "app", "apple-icon.png"));
console.log("Generated wordmarks, icons, browser favicon, and Apple touch icon.");
