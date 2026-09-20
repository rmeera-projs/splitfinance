delete process.env.COHERE_API_KEY;

const { extractReceipt } = require("./receiptService");

const IMAGE = Buffer.from("fake-image-bytes");

function clientReturning(text) {
  return { chat: jest.fn().mockResolvedValue({ message: { content: [{ type: "text", text }] } }) };
}

describe("extractReceipt", () => {
  test("converts the model's dollar total to integer cents", async () => {
    const client = clientReturning('{"merchant": "Olive Garden", "total": 60.5}');

    expect(await extractReceipt(IMAGE, "image/jpeg", { client })).toEqual({ merchant: "Olive Garden", total: 6050 });
  });

  test("sends the image as a data URI with the mime type detected from its bytes", async () => {
    const client = clientReturning('{"merchant": null, "total": 10}');

    await extractReceipt(IMAGE, "image/png", { client });

    const content = client.chat.mock.calls[0][0].messages[0].content;
    expect(content[1]).toEqual({
      type: "image_url",
      imageUrl: { url: `data:image/png;base64,${IMAGE.toString("base64")}` },
    });
  });

  test("tolerates a markdown fence around the JSON", async () => {
    const client = clientReturning('```json\n{"merchant": "Cafe", "total": 4}\n```');
    expect(await extractReceipt(IMAGE, "image/jpeg", { client })).toEqual({ merchant: "Cafe", total: 400 });
  });

  test.each([
    ["a null total", '{"merchant": "X", "total": null}'],
    ["a zero total", '{"merchant": "X", "total": 0}'],
    ["a negative total", '{"merchant": "X", "total": -5}'],
    ["a non-numeric total", '{"merchant": "X", "total": "lots"}'],
    ["no JSON at all", "I cannot read this image"],
  ])("returns null for %s", async (_label, reply) => {
    expect(await extractReceipt(IMAGE, "image/jpeg", { client: clientReturning(reply) })).toBeNull();
  });

  test("keeps the total when the merchant is unreadable", async () => {
    const client = clientReturning('{"merchant": "  ", "total": 12}');
    expect(await extractReceipt(IMAGE, "image/jpeg", { client })).toEqual({ merchant: null, total: 1200 });
  });

  test("returns null rather than throwing when the API call fails", async () => {
    const client = { chat: jest.fn().mockRejectedValue(new Error("boom")) };
    jest.spyOn(console, "error").mockImplementation(() => {});

    expect(await extractReceipt(IMAGE, "image/jpeg", { client })).toBeNull();
  });

  test("throws a 503 when no Cohere client is configured", async () => {
    await expect(extractReceipt(IMAGE, "image/jpeg")).rejects.toMatchObject({ status: 503 });
  });
});
