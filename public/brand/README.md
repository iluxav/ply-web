# ply · Solid console

The approved website identity: a solid pixel wordmark and a compact p + cursor icon.

## SVG masters

- [Wordmark for dark backgrounds](wordmark-dark.svg)
- [Wordmark for light backgrounds](wordmark-light.svg)
- [White monochrome wordmark](wordmark-white.svg)
- [Black monochrome wordmark](wordmark-black.svg)
- [Adaptive favicon](icon.svg) — follows the browser color scheme
- [Dark icon](icon-dark.svg)
- [Light icon](icon-light.svg)

## Raster exports

- Wordmarks: `wordmark-{dark,light,white,black}.png`, 1000 × 360, transparent.
- Icons: `icon-{dark,light}-{16,32,48,64,128,180,192,512}.png`.
- [Browser favicon](favicon.ico): 16, 32, and 48px PNG frames.
- [Apple touch icon](apple-touch-icon.png): 180 × 180, opaque charcoal.
- [Social preview](social-card.png): 1200 × 630, shared by Open Graph and Twitter.

## Palette and sizing

Dark: charcoal #151515, off-white #EEECE5, green #73D69B.
Light: off-white #F4F5F1, charcoal #151515, green #207746.

The wordmark's native grid is 100 × 36. Prefer whole multiples; the website uses 100 × 36. The icon's grid is 16 × 16. Preserve the built-in padding. Use the compact icon for small square placements.

Run `npm run brand:build` from the app directory to regenerate PNGs, ICO, and the Apple touch icon. SVG files are the editable masters. The social image is rendered by `app/opengraph-image.tsx`; its exported PNG is a snapshot of that route.
