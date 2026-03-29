#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const { capturePage, launchBrowser, BREAKPOINTS } = require("./index")

const args = process.argv.slice(2)

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: magnifito-webshot <url...> [options]

Options:
  -f, --file <path>           File with URLs (one per line)
  -o, --output <dir>          Output directory (default: ./screenshots)
  -b, --breakpoint <name>     Breakpoint: sm, md, lg, xl, 2xl (default: full 1920px)
  -w, --width <pixels>        Custom width in pixels (overrides breakpoint)
  -F, --format <type>         Output format: png, jpg, webp (default: png)
  -q, --quality <1-100>       Quality for jpg/webp (default: browser default)
  -d, --delay <ms>            Wait time in ms after scrolling (default: 0)
  -i, --image-timeout <ms>    Wait time in ms for images to load (default: 30000)
  -c, --concurrency <n>       URLs to process in parallel (default: 3)
      --wait-until <type>     Wait condition: networkidle0, networkidle2 (default: networkidle2)
      --batch-delay <ms>      Wait time between batches (default: 0)
      --no-scroll             Skip auto-scrolling
  -h, --help                  Show this help

Examples:
  magnifito-webshot https://example.com
  magnifito-webshot https://example.com https://google.com -o ./out
  magnifito-webshot -f urls.txt -b lg -c 2
  magnifito-webshot https://example.com --wait-until networkidle0
  magnifito-webshot https://example.com --no-scroll -d 2000`)
  process.exit(0)
}

const getArg = (flags) => {
  for (const flag of flags) {
    const idx = args.indexOf(flag)
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1]
  }
  return null
}

const filenameFromUrl = (url) => {
  try {
    const u = new URL(url)
    const decoded = decodeURIComponent(u.hostname + u.pathname)
    const name = decoded.replace(/[<>:"/\\|?*]/g, "_").replace(/^_+|_+$/g, "")
    return name || "screenshot"
  } catch {
    return "screenshot"
  }
}

const run = async () => {
  const urls = args.filter((a) => !a.startsWith("-") && (a.startsWith("http://") || a.startsWith("https://")))

  const file = getArg(["-f", "--file"])
  if (file) {
    const content = fs.readFileSync(path.resolve(file), "utf-8")
    const lines = content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    urls.push(...lines)
  }

  if (urls.length === 0) {
    console.error("Error: At least one URL is required. Use -f for a file or pass URLs directly.")
    process.exit(1)
  }

  const outputDir = getArg(["-o", "--output"]) || "./screenshots"
  const breakpoint = getArg(["-b", "--breakpoint"])
  const customWidth = getArg(["-w", "--width"])
  const format = getArg(["-F", "--format"]) || "png"
  const qualityArg = getArg(["-q", "--quality"])
  const delayArg = getArg(["-d", "--delay"])
  const imageTimeoutArg = getArg(["-i", "--image-timeout"])
  const concurrencyArg = getArg(["-c", "--concurrency"])
  const waitUntil = getArg(["--wait-until"]) || "networkidle2"
  const batchDelayArg = getArg(["--batch-delay"])
  const scroll = !args.includes("--no-scroll")

  const validFormats = ["png", "jpg", "jpeg", "webp"]
  if (!validFormats.includes(format)) {
    console.error(`Error: Unknown format "${format}". Use: png, jpg, webp`)
    process.exit(1)
  }

  const quality = qualityArg ? parseInt(qualityArg, 10) : undefined
  if (quality !== undefined && (isNaN(quality) || quality < 1 || quality > 100)) {
    console.error("Error: --quality must be between 1 and 100")
    process.exit(1)
  }

  const delay = delayArg ? parseInt(delayArg, 10) : 0
  if (isNaN(delay) || delay < 0) {
    console.error("Error: --delay must be a non-negative number")
    process.exit(1)
  }

  const imageTimeout = imageTimeoutArg ? parseInt(imageTimeoutArg, 10) : 30000
  if (isNaN(imageTimeout) || imageTimeout < 0) {
    console.error("Error: --image-timeout must be a non-negative number")
    process.exit(1)
  }

  const concurrency = concurrencyArg ? parseInt(concurrencyArg, 10) : 3
  if (isNaN(concurrency) || concurrency < 1) {
    console.error("Error: --concurrency must be a positive number")
    process.exit(1)
  }

  const batchDelay = batchDelayArg ? parseInt(batchDelayArg, 10) : 0
  if (isNaN(batchDelay) || batchDelay < 0) {
    console.error("Error: --batch-delay must be a non-negative number")
    process.exit(1)
  }

  if (waitUntil !== "networkidle0" && waitUntil !== "networkidle2") {
    console.error("Error: --wait-until must be either networkidle0 or networkidle2")
    process.exit(1)
  }

  let width = 1920
  if (customWidth) {
    width = parseInt(customWidth, 10)
    if (isNaN(width) || width <= 0) {
      console.error("Error: --width must be a positive number")
      process.exit(1)
    }
  } else if (breakpoint) {
    if (!BREAKPOINTS[breakpoint]) {
      console.error(`Error: Unknown breakpoint "${breakpoint}". Use: ${Object.keys(BREAKPOINTS).join(", ")}`)
      process.exit(1)
    }
    width = BREAKPOINTS[breakpoint]
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const ext = format === "jpeg" ? "jpg" : format
  console.log(`Capturing ${urls.length} URL(s) at ${width}px (${format})...\n`)

  const browser = await launchBrowser()
  let failed = 0

  try {
    for (let i = 0; i < urls.length; i += concurrency) {
      const chunk = urls.slice(i, i + concurrency)
      console.log(`Processing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(urls.length / concurrency)}...`)

      await Promise.all(chunk.map(async (url) => {
        const filename = `${filenameFromUrl(url)}_${width}.${ext}`
        const outPath = path.resolve(outputDir, filename)
        const page = await browser.newPage()
        try {
          const buf = await capturePage(page, { url, width, format, quality, delay, scroll, waitUntil, imageTimeout })
          fs.writeFileSync(outPath, buf)
          console.log(`Saved: ${outPath}`)
        } catch (err) {
          console.error(`Failed: ${url} — ${err.message}`)
          failed++
        } finally {
          await page.close()
        }
      }))
      
      if (batchDelay > 0 && i + concurrency < urls.length) {
        console.log(`Waiting ${batchDelay}ms before next batch...`)
        await new Promise((r) => setTimeout(r, batchDelay))
      }
      console.log("")
    }
  } finally {
    await browser.close()
  }

  console.log(`Done: ${urls.length - failed}/${urls.length} succeeded`)
  if (failed > 0) process.exit(1)
}

run()
