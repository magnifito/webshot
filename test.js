const { describe, it, before, after } = require("node:test")
const assert = require("node:assert")
const http = require("http")
const sharp = require("sharp")
const { app, takeScreenshot, BREAKPOINTS, MAX_TEXTURE_HEIGHT } = require("./index")

const TEST_PORT = 3099
const BASE_URL = `http://localhost:${TEST_PORT}`

const get = (path) =>
  new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => resolve({ status: res.statusCode, body: data }))
    }).on("error", reject)
  })

describe("screenshot API", () => {
  let server

  before(() => {
    return new Promise((resolve) => {
      server = app.listen(TEST_PORT, resolve)
    })
  })

  after(() => {
    return new Promise((resolve) => {
      server.close(resolve)
    })
  })

  it("returns error when no URL provided", async () => {
    const res = await get("/screenshot")
    assert.strictEqual(res.body, "No URL provided")
  })

  it("captures a screenshot and returns base64 PNG", async () => {
    const res = await get("/screenshot?url=https://example.com")
    const json = JSON.parse(res.body)
    assert.ok(json.image, "response should have an image field")
    assert.ok(
      json.image.startsWith("data:image/png;base64,"),
      "image should be a base64 data URI"
    )

    const buf = Buffer.from(
      json.image.replace("data:image/png;base64,", ""),
      "base64"
    )
    const meta = await sharp(buf).metadata()
    assert.strictEqual(meta.format, "png")
    assert.strictEqual(meta.width, 1920, "default width should be 1920")
    assert.ok(meta.height > 0, "height should be positive")
  })

  it("respects breakpoint parameter", async () => {
    const res = await get("/screenshot?url=https://example.com&breakpoint=sm")
    const json = JSON.parse(res.body)
    const buf = Buffer.from(
      json.image.replace("data:image/png;base64,", ""),
      "base64"
    )
    const meta = await sharp(buf).metadata()
    assert.strictEqual(meta.width, BREAKPOINTS.sm)
  })
})

describe("takeScreenshot", () => {
  it("throws when no site provided", async () => {
    await assert.rejects(() => takeScreenshot(null), {
      message: "No site provided",
    })
  })

  it("captures a short page without stitching", async () => {
    const buf = await takeScreenshot({
      url: "https://example.com",
      width: 1024,
    })
    assert.ok(Buffer.isBuffer(buf), "should return a buffer")
    const meta = await sharp(buf).metadata()
    assert.strictEqual(meta.width, 1024)
    assert.ok(
      meta.height <= MAX_TEXTURE_HEIGHT,
      "example.com should be under texture limit"
    )
  })
})
