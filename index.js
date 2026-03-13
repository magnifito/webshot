const express = require("express")
const puppeteer = require("puppeteer")
const cors = require("cors")
const sharp = require("sharp")

var corsOptions = {
  origin: "*",
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
}


const PORT = process.env.PORT || 3011
const app = express()
const environment = process.env.NODE_ENV
const isProduction = environment === "production"

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
}

const autoScroll = async (page) => {
  await page.evaluate(async () => {
    await new Promise(async (resolve) => {
      const distance = 100

      while (true) {
        const oldScrollHeight = document.body.scrollHeight

        // Scroll down
        window.scrollBy(0, distance)
        await new Promise((r) => setTimeout(r, 100))

        // Check if we hit the bottom
        if (window.innerHeight + window.scrollY >= document.body.scrollHeight) {
          // Wait for load (2 seconds)
          await new Promise((r) => setTimeout(r, 2000))

          // Check if content expanded
          if (document.body.scrollHeight <= oldScrollHeight) {
            break // Done
          }
        }
      }
      resolve()
    })
  })
}

const MAX_TEXTURE_HEIGHT = 16384

const takeScreenshot = async (site) => {
  if (!site) {
    throw new Error("No site provided")
  }

  const viewportWidth = site.width || 1920
  const browser = await puppeteer.launch({
    ...(isProduction && { executablePath: process.env.CHROMIUM_PATH }),
    headless: "new",
    defaultViewport: { width: viewportWidth, height: 1080 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  })

  let page
  try {
    console.log(`📸 Capturing: ${site.url} | Width: ${viewportWidth}px`)
    page = await browser.newPage()

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
    )
    await page.goto(site.url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    })

    await autoScroll(page)
    await new Promise((resolve) => setTimeout(resolve, 5000))

    const pageHeight = await page.evaluate(() => document.body.scrollHeight)
    console.log(`📏 Page height: ${pageHeight}px`)

    if (pageHeight <= MAX_TEXTURE_HEIGHT) {
      const screenshot = await page.screenshot({ fullPage: true, type: "png" })
      return screenshot
    }

    // Tall page: take tiled screenshots and stitch
    console.log(`🧵 Page exceeds ${MAX_TEXTURE_HEIGHT}px, stitching tiles...`)
    const tiles = []
    let y = 0
    while (y < pageHeight) {
      const tileHeight = Math.min(MAX_TEXTURE_HEIGHT, pageHeight - y)
      const tile = await page.screenshot({
        type: "png",
        clip: { x: 0, y, width: viewportWidth, height: tileHeight },
      })
      tiles.push({ buffer: tile, y, height: tileHeight })
      console.log(`  📷 Tile: y=${y} h=${tileHeight}`)
      y += tileHeight
    }

    const stitched = await sharp({
      create: {
        width: viewportWidth,
        height: pageHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite(
        tiles.map((t) => ({ input: t.buffer, top: t.y, left: 0 }))
      )
      .png()
      .toBuffer()

    console.log(`✅ Stitched ${tiles.length} tiles into ${pageHeight}px image`)
    return stitched
  } catch (err) {
    console.error(`❌ Failed to capture ${site.url}:`, err.message)
    throw err
  } finally {
    if (page) await page.close()
    await browser.close()
  }
}


app.use(cors(corsOptions))
app.get("/screenshot", async (req, res) => {
  if (!req.query.url) {
    return res.send("No URL provided")
  }

  const breakpoint = req.query.breakpoint
  const width = BREAKPOINTS[breakpoint] ? BREAKPOINTS[breakpoint] : 1920

  const image = await takeScreenshot({ url: req.query.url, width })
  res.send({
    image: "data:image/png;base64," + Buffer.from(image).toString("base64"),
  })
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`listening to port: ${PORT}`)
  })
}

module.exports = { app, takeScreenshot, BREAKPOINTS, MAX_TEXTURE_HEIGHT }
