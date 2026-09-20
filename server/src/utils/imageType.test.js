const { detectImageType } = require("./imageType");

const pad = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

describe("detectImageType", () => {
  test("recognises JPEG, PNG and WebP by their leading bytes", () => {
    expect(detectImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]))).toBe(
      "image/webp"
    );
  });

  test("rejects other content regardless of what it claims to be", () => {
    expect(detectImageType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectImageType(Buffer.from("%PDF-1.7 not an image at all"))).toBeNull();
  });

  test("rejects a RIFF file that is not WebP", () => {
    expect(detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(8)]))).toBeNull();
  });

  test("rejects buffers too short to identify, and non-buffers", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(null)).toBeNull();
  });
});
