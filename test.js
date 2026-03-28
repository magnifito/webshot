const { describe, it, before, after } = require("node:test")
const assert = require("node:assert")
const http = require("http")
const fs = require("fs")
const path = require("path")
const { execFile } = require("child_process")
const sharp = require("sharp")
const { takeScreenshot, capturePage, launchBrowser, BREAKPOINTS, MAX_TEXTURE_HEIGHT } = require("./index")

const TEST_PORT = 3099
const TEST_URL = `http://localhost:${TEST_PORT}`
const TEST_OUTPUT = path.join(__dirname, ".test-screenshots")

let testServer

const cleanup = () => {
  if (fs.existsSync(TEST_OUTPUT)) fs.rmSync(TEST_OUTPUT, { recursive: true })
}

const runCli = (args) => new Promise((resolve) => {
  execFile("node", ["cli.js", ...args], { cwd: __dirname, timeout: 60000 }, (err, stdout, stderr) => {
    resolve({ code: err ? err.code : 0, stdout, stderr })
  })
})

// Global setup: one test HTTP server for the whole suite
before(async () => {
  testServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" })
    if (req.url === "/tall") {
      res.end(`<html><body style="margin:0"><div style="width:100%;height:5000px;background:linear-gradient(red,blue)"></div></body></html>`)
    } else {
      res.end(`<html><body style="margin:0"><div style="width:100%;height:200px;background:green"></div></body></html>`)
    }
  })
  await new Promise((resolve) => testServer.listen(TEST_PORT, resolve))
})

after(async () => {
  cleanup()
  await new Promise((resolve) => testServer.close(resolve))
})

// --- Exports ---

describe("module exports", () => {
  it("exports expected functions and constants", () => {
    assert.strictEqual(typeof takeScreenshot, "function")
    assert.strictEqual(typeof capturePage, "function")
    assert.strictEqual(typeof launchBrowser, "function")
    assert.strictEqual(typeof BREAKPOINTS, "object")
    assert.strictEqual(typeof MAX_TEXTURE_HEIGHT, "number")
  })

  it("BREAKPOINTS has correct values", () => {
    assert.deepStrictEqual(BREAKPOINTS, {
      sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536,
    })
  })

  it("MAX_TEXTURE_HEIGHT is 16384", () => {
    assert.strictEqual(MAX_TEXTURE_HEIGHT, 16384)
  })
})

// --- takeScreenshot (standalone, manages own browser) ---

describe("takeScreenshot", () => {
  it("throws when no URL provided", async () => {
    await assert.rejects(() => takeScreenshot({}), { message: "No URL provided" })
  })

  it("throws on invalid URL", async () => {
    await assert.rejects(() => takeScreenshot({ url: "not-a-url", scroll: false }))
  })

  it("captures a page and returns a valid PNG buffer", async () => {
    const buf = await takeScreenshot({ url: TEST_URL, scroll: false })
    assert.ok(Buffer.isBuffer(buf))
    const meta = await sharp(buf).metadata()
    assert.strictEqual(meta.format, "png")
    assert.strictEqual(meta.width, 1920)
    assert.ok(meta.height > 0)
  })

  it("respects custom width", async () => {
    const buf = await takeScreenshot({ url: TEST_URL, width: 800, scroll: false })
    const meta = await sharp(buf).metadata()
    assert.strictEqual(meta.width, 800)
  })
})

// --- capturePage + launchBrowser (shared browser) ---

describe("capturePage with shared browser", () => {
  let browser

  before(async () => { browser = await launchBrowser() })
  after(async () => { await browser.close() })

  it("captures a page using a shared browser", async () => {
    const page = await browser.newPage()
    try {
      const buf = await capturePage(page, { url: TEST_URL, width: 1024, scroll: false })
      const meta = await sharp(buf).metadata()
      assert.strictEqual(meta.format, "png")
      assert.strictEqual(meta.width, 1024)
    } finally {
      await page.close()
    }
  })

  it("captures multiple pages sequentially on the same browser", async () => {
    for (const width of [640, 1280]) {
      const page = await browser.newPage()
      try {
        const buf = await capturePage(page, { url: TEST_URL, width, scroll: false })
        const meta = await sharp(buf).metadata()
        assert.strictEqual(meta.width, width)
      } finally {
        await page.close()
      }
    }
  })

  it("throws when URL is missing", async () => {
    const page = await browser.newPage()
    try {
      await assert.rejects(() => capturePage(page, {}), { message: "No URL provided" })
    } finally {
      await page.close()
    }
  })
})

// --- Format and quality ---

describe("output formats", () => {
  let browser

  before(async () => { browser = await launchBrowser() })
  after(async () => { await browser.close() })

  const capture = async (opts) => {
    const page = await browser.newPage()
    try {
      return await capturePage(page, { url: TEST_URL, scroll: false, ...opts })
    } finally {
      await page.close()
    }
  }

  it("outputs PNG by default", async () => {
    const buf = await capture({})
    const meta = await sharp(buf).metadata()
    assert.strictEqual(meta.format, "png")
  })

  it("outputs JPEG with format: jpg", async () => {
    const buf = await capture({ format: "jpg" })
    const meta = await sharp(buf).metadata()
    assert.strictEqual(meta.format, "jpeg")
  })

  it("outputs JPEG with format: jpeg", async () => {
    const buf = await capture({ format: "jpeg" })
    const meta = await sharp(buf).metadata()
    assert.strictEqual(meta.format, "jpeg")
  })

  it("outputs WebP with format: webp", async () => {
    const buf = await capture({ format: "webp" })
    const meta = await sharp(buf).metadata()
    assert.strictEqual(meta.format, "webp")
  })

  it("low quality JPEG is smaller than high quality", async () => {
    const lowQ = await capture({ format: "jpg", quality: 10 })
    const highQ = await capture({ format: "jpg", quality: 95 })
    assert.ok(lowQ.length < highQ.length, `low ${lowQ.length} should be < high ${highQ.length}`)
  })

  it("WebP quality affects output size", async () => {
    const lowQ = await capture({ format: "webp", quality: 1 })
    const highQ = await capture({ format: "webp", quality: 100 })
    assert.notStrictEqual(lowQ.length, highQ.length, "different quality settings should produce different sizes")
  })
})

// --- Scroll and delay options ---

describe("scroll and delay options", () => {
  it("works with scroll disabled", async () => {
    const buf = await takeScreenshot({ url: TEST_URL, scroll: false })
    assert.ok(Buffer.isBuffer(buf))
    const meta = await sharp(buf).metadata()
    assert.ok(meta.height > 0)
  })

  it("respects delay option", async () => {
    const start = Date.now()
    const buf = await takeScreenshot({ url: TEST_URL, scroll: false, delay: 500 })
    const elapsed = Date.now() - start
    assert.ok(Buffer.isBuffer(buf))
    assert.ok(elapsed >= 500, `expected >= 500ms, got ${elapsed}ms`)
  })
})

// --- CLI ---

describe("CLI", () => {
  it("shows help with --help", async () => {
    const { code, stdout } = await runCli(["--help"])
    assert.strictEqual(code, 0)
    assert.ok(stdout.includes("Usage: magnifito-webshot"))
    assert.ok(stdout.includes("--format"))
    assert.ok(stdout.includes("--no-scroll"))
  })

  it("shows help with no arguments", async () => {
    const { code, stdout } = await runCli([])
    assert.strictEqual(code, 0)
    assert.ok(stdout.includes("Usage:"))
  })

  it("errors when no URLs provided", async () => {
    const { code, stderr } = await runCli(["-o", TEST_OUTPUT])
    assert.strictEqual(code, 1)
    assert.ok(stderr.includes("At least one URL is required"))
  })

  it("errors on invalid format", async () => {
    const { code, stderr } = await runCli([TEST_URL, "-F", "bmp"])
    assert.strictEqual(code, 1)
    assert.ok(stderr.includes("Unknown format"))
  })

  it("errors on invalid quality", async () => {
    const { code, stderr } = await runCli([TEST_URL, "-q", "999"])
    assert.strictEqual(code, 1)
    assert.ok(stderr.includes("--quality"))
  })

  it("errors on invalid width", async () => {
    const { code, stderr } = await runCli([TEST_URL, "-w", "-5"])
    assert.strictEqual(code, 1)
    assert.ok(stderr.includes("--width"))
  })

  it("errors on invalid concurrency", async () => {
    const { code, stderr } = await runCli([TEST_URL, "-c", "0"])
    assert.strictEqual(code, 1)
    assert.ok(stderr.includes("--concurrency"))
  })

  it("errors on unknown breakpoint", async () => {
    const { code, stderr } = await runCli([TEST_URL, "-b", "xxl"])
    assert.strictEqual(code, 1)
    assert.ok(stderr.includes("Unknown breakpoint"))
  })

  it("captures a URL and saves to output dir", async () => {
    cleanup()
    const { code, stdout } = await runCli([TEST_URL, "-o", TEST_OUTPUT, "--no-scroll"])
    assert.strictEqual(code, 0)
    assert.ok(stdout.includes("Saved:"))
    assert.ok(stdout.includes("Done: 1/1 succeeded"))
    const files = fs.readdirSync(TEST_OUTPUT)
    assert.strictEqual(files.length, 1)
    assert.ok(files[0].endsWith(".png"))
    const meta = await sharp(path.join(TEST_OUTPUT, files[0])).metadata()
    assert.strictEqual(meta.format, "png")
    assert.strictEqual(meta.width, 1920)
  })

  it("captures with custom width and jpg format", async () => {
    cleanup()
    const { code } = await runCli([TEST_URL, "-o", TEST_OUTPUT, "-w", "800", "-F", "jpg", "--no-scroll"])
    assert.strictEqual(code, 0)
    const files = fs.readdirSync(TEST_OUTPUT)
    assert.strictEqual(files.length, 1)
    assert.ok(files[0].endsWith(".jpg"))
    const meta = await sharp(path.join(TEST_OUTPUT, files[0])).metadata()
    assert.strictEqual(meta.format, "jpeg")
    assert.strictEqual(meta.width, 800)
  })

  it("reads URLs from a file", async () => {
    cleanup()
    const urlFile = path.join(__dirname, ".test-urls.txt")
    fs.writeFileSync(urlFile, `# comment\n${TEST_URL}\n${TEST_URL}/tall\n`)
    try {
      const { code, stdout } = await runCli(["-f", urlFile, "-o", TEST_OUTPUT, "--no-scroll"])
      assert.strictEqual(code, 0)
      assert.ok(stdout.includes("Done: 2/2 succeeded"))
      const files = fs.readdirSync(TEST_OUTPUT)
      assert.strictEqual(files.length, 2)
    } finally {
      fs.unlinkSync(urlFile)
    }
  })

  it("uses breakpoint width", async () => {
    cleanup()
    const { code } = await runCli([TEST_URL, "-o", TEST_OUTPUT, "-b", "sm", "--no-scroll"])
    assert.strictEqual(code, 0)
    const files = fs.readdirSync(TEST_OUTPUT)
    assert.ok(files[0].includes("_640."))
    const meta = await sharp(path.join(TEST_OUTPUT, files[0])).metadata()
    assert.strictEqual(meta.width, 640)
  })
})
