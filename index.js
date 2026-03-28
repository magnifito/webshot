const puppeteer = require("puppeteer")
const sharp = require("sharp")

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
}

const MAX_TEXTURE_HEIGHT = 16384

const autoScroll = async (page) => {
  await page.evaluate(async () => {
    await new Promise(async (resolve) => {
      const distance = 100
      while (true) {
        const oldScrollHeight = document.body.scrollHeight
        window.scrollBy(0, distance)
        await new Promise((r) => setTimeout(r, 100))
        if (window.innerHeight + window.scrollY >= document.body.scrollHeight) {
          await new Promise((r) => setTimeout(r, 2000))
          if (document.body.scrollHeight <= oldScrollHeight) break
        }
      }
      resolve()
    })
  })
}

const formatImage = async (buffer, { format = "png", quality }) => {
  const pipeline = sharp(buffer)
  switch (format) {
    case "jpeg":
    case "jpg":
      return pipeline.jpeg(quality ? { quality } : {}).toBuffer()
    case "webp":
      return pipeline.webp(quality ? { quality } : {}).toBuffer()
    default:
      return pipeline.png().toBuffer()
  }
}

const capturePage = async (page, options = {}) => {
  const { url, width = 1920, format = "png", quality, delay = 0, scroll = true } = options

  if (!url) throw new Error("No URL provided")

  console.log(`📸 Capturing: ${url} | Width: ${width}px`)
  await page.setViewport({ width, height: 1080 })
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 })

  if (scroll) await autoScroll(page)
  if (delay > 0) await new Promise((r) => setTimeout(r, delay))

  const pageHeight = await page.evaluate(() => document.body.scrollHeight)
  console.log(`📏 Page height: ${pageHeight}px`)

  let rawBuffer

  if (pageHeight <= MAX_TEXTURE_HEIGHT) {
    rawBuffer = await page.screenshot({ fullPage: true, type: "png" })
  } else {
    console.log(`🧵 Page exceeds ${MAX_TEXTURE_HEIGHT}px, stitching tiles...`)
    const tiles = []
    let y = 0
    while (y < pageHeight) {
      const tileHeight = Math.min(MAX_TEXTURE_HEIGHT, pageHeight - y)
      const tile = await page.screenshot({
        type: "png",
        clip: { x: 0, y, width, height: tileHeight },
      })
      tiles.push({ buffer: tile, y, height: tileHeight })
      console.log(`  📷 Tile: y=${y} h=${tileHeight}`)
      y += tileHeight
    }

    rawBuffer = await sharp({
      create: {
        width,
        height: pageHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite(tiles.map((t) => ({ input: t.buffer, top: t.y, left: 0 })))
      .png()
      .toBuffer()

    console.log(`✅ Stitched ${tiles.length} tiles into ${pageHeight}px image`)
  }

  return formatImage(rawBuffer, { format, quality })
}

const launchBrowser = async () => {
  return puppeteer.launch({
    headless: "new",
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  })
}

const takeScreenshot = async (options) => {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    try {
      return await capturePage(page, options)
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

module.exports = { takeScreenshot, capturePage, launchBrowser, BREAKPOINTS, MAX_TEXTURE_HEIGHT }
