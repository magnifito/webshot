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

const removeOverlays = async (page) => {
  await page.evaluate(() => {
    const selectors = [
      '[id*="cookie"]', '[class*="cookie"]',
      '[id*="consent"]', '[class*="consent"]',
      '[id*="gdpr"]', '[class*="gdpr"]',
      '[id*="privacy"]', '[class*="privacy"]',
      '[class*="banner"]', '[id*="banner"]',
      '[class*="modal"]', '[id*="modal"]',
      '[class*="overlay"]', '[id*="overlay"]',
      '[class*="popup"]', '[id*="popup"]',
    ]
    selectors.forEach((selector) => {
      try {
        const elements = document.querySelectorAll(selector)
        elements.forEach((el) => {
          const style = window.getComputedStyle(el)
          if (style.position === "fixed" || style.position === "absolute" || parseInt(style.zIndex, 10) > 100) {
            el.style.display = "none"
            el.style.opacity = "0"
            el.style.pointerEvents = "none"
          }
        })
      } catch (e) {
        // Ignore selector errors
      }
    })
    // Also try to find common "Accept" buttons and click them if they are small/likely
    // But hiding is safer for screenshots.
  })
}

const fixStickyElements = async (page) => {
  await page.evaluate(() => {
    const elements = document.querySelectorAll("*")
    elements.forEach((el) => {
      const style = window.getComputedStyle(el)
      if (style.position === "fixed" || style.position === "sticky") {
        el.style.position = "absolute"
      }
    })
  })
}

const waitForImages = async (page) => {
  await page.evaluate(async () => {
    const selectors = Array.from(document.querySelectorAll("img"))
    const timeout = 15000 // 15 seconds max wait for images
    await Promise.all(
      selectors.map((img) => {
        if (img.complete) return Promise.resolve()
        return new Promise((resolve) => {
          const timer = setTimeout(resolve, timeout)
          img.addEventListener("load", () => {
            clearTimeout(timer)
            resolve()
          })
          img.addEventListener("error", () => {
            clearTimeout(timer)
            resolve()
          })
        })
      })
    )
  })
}

const autoScroll = async (page) => {
  await page.evaluate(async () => {
    await new Promise(async (resolve) => {
      let totalHeight = 0
      const distance = 150 // Slightly larger steps for faster triggering
      const timer = setInterval(() => {
        const { scrollHeight } = document.body
        window.scrollBy(0, distance)
        totalHeight += distance

        if (totalHeight >= scrollHeight) {
          clearInterval(timer)
          resolve()
        }
      }, 150) // More time between scrolls for JS to react
    })
  })
  // Scroll back to top to handle sticky headers correctly when we fix them
  await page.evaluate(() => window.scrollTo(0, 0))
  // Wait for the final layout to settle after scrolling back
  await new Promise((r) => setTimeout(r, 2000))
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
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 })

  // First pass: Hide obvious overlays before scrolling
  await removeOverlays(page)

  if (scroll) {
    await autoScroll(page)
    // Wait for any final assets triggered by scrolling
    try {
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {})
    } catch (e) {}
  }

  // Second pass: Hide any overlays that appeared during scroll
  await removeOverlays(page)

  // Ensure all images (including lazy-loaded ones) are ready
  await waitForImages(page)

  if (delay > 0) await new Promise((r) => setTimeout(r, delay))

  // Fix sticky elements after scrolling so they stay at the top and don't repeat
  await fixStickyElements(page)

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
    protocolTimeout: 120000,
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
