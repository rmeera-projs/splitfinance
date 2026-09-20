// Identifies an uploaded image by its leading bytes rather than by the
// filename extension or the client-supplied Content-Type, both of which are
// just strings the uploader chose. Anything not recognised here is rejected
// before it goes anywhere near a model.
//
// HEIC (the iPhone default) is deliberately absent: the vision endpoint takes
// JPEG/PNG/WebP, and most browsers convert HEIC to JPEG on upload from a
// file input anyway.

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";

  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => buffer[i] === byte)) return "image/png";

  // WebP is a RIFF container: "RIFF" <size> "WEBP".
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";

  return null;
}

module.exports = { detectImageType };
