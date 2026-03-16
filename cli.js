#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const { takeScreenshot, BREAKPOINTS } = require("./index")

const args = process.argv.slice(2)

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: webshot <url...> [options]

Options:
  -f, --file <path>         File with URLs (one per line)
  -o, --output <dir>        Output directory (default: ./screenshots)
  -b, --breakpoint <name>   Breakpoint: sm, md, lg, xl, 2xl (default: full 1920px)
  -w, --width <pixels>      Custom width in pixels (overrides breakpoint)
      --serve                Start the HTTP server instead
  -p, --port <port>         Port for --serve mode (default: 3011)
  -h, --help                Show this help

Note: URLs are processed in batches of 5. Screenshots are named based on the full URL path to ensure uniqueness.

Examples:
  webshot https://example.com
  webshot https://example.com https://google.com -o ./out
  webshot -f urls.txt -b lg
  webshot --serve -p 8080`)
  process.exit(0)
}

const getArg = (flags) => {
  for (const flag of flags) {
    const idx = args.indexOf(flag)
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1]
  }
  return null
}

const hasFlag = (flags) => flags.some((f) => args.includes(f))

const filenameFromUrl = (url) => {
  try {
    const u = new URL(url)
    const name = (u.hostname + u.pathname).replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "")
    return name || "screenshot"
  } catch {
    return "screenshot"
  }
}

const run = async () => {
  if (hasFlag(["--serve"])) {
    const port = getArg(["-p", "--port"]) || process.env.PORT || 3011
    const { app } = require("./index")
    app.listen(port, () => {
      console.log(`Screenshot server listening on port ${port}`)
    })
    return
  }

  // Collect URLs from args and/or file
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

  console.log(`Capturing ${urls.length} URL(s) at ${width}px...\n`)

  let failed = 0
  const BATCH_SIZE = 5

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const chunk = urls.slice(i, i + BATCH_SIZE)
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(urls.length / BATCH_SIZE)}...`)
    
    await Promise.all(chunk.map(async (url) => {
      const filename = `${filenameFromUrl(url)}_${width}.png`
      const outPath = path.resolve(outputDir, filename)
      try {
        const buf = await takeScreenshot({ url, width })
        fs.writeFileSync(outPath, buf)
        console.log(`Saved: ${outPath}`)
      } catch (err) {
        console.error(`Failed: ${url} — ${err.message}`)
        failed++
      }
    }))
    console.log("") // Add newline after batch
  }

  console.log(`Done: ${urls.length - failed}/${urls.length} succeeded`)
  if (failed > 0) process.exit(1)
}

run()
