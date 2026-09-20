const multer = require("multer");
const { ApiError } = require("../middleware/errorHandler");
const { detectImageType } = require("../utils/imageType");
const { extractReceipt } = require("../services/receiptService");

// A phone photo is typically 1-4MB. The cap bounds what one request can make
// this process buffer on a 1GB instance; memory storage (never disk) is what
// keeps the image from ever being persisted anywhere.
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 },
}).single("receipt");

// multer reports its own failures as MulterError, which the central error
// handler would turn into a 500. Map the ones a user can cause to a 4xx.
function receiveUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return next(new ApiError(413, "That image is too large - the limit is 5MB"));
    if (err instanceof multer.MulterError) return next(new ApiError(400, "Upload one image in the 'receipt' field"));
    next(err);
  });
}

async function scanReceipt(req, res, next) {
  try {
    if (!req.file) throw new ApiError(400, "Choose a receipt image to upload");

    const mimeType = detectImageType(req.file.buffer);
    if (!mimeType) throw new ApiError(400, "That file isn't a JPEG, PNG or WebP image");

    const result = await extractReceipt(req.file.buffer, mimeType);
    if (!result) {
      throw new ApiError(422, "Couldn't read a total from that image - try a clearer photo, or enter it by hand");
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { receiveUpload, scanReceipt, MAX_RECEIPT_BYTES };
