delete process.env.COHERE_API_KEY;

const { extractReceipt } = require("./receiptService");

const IMAGE = Buffer.from("fake-image-bytes");

function clientReturning(text) {
  return { chat: jest.fn().mockResolvedValue({ message: { content: [{ type: "text", text }] } }) };
}

describe("extractReceipt", () => {
  test("converts the model's dollar total to integer cents", async () => {
    const client = clientReturning('{"merchant": "Olive Garden", "total": 60.5}');

    expect(await extractReceipt(IMAGE, "image/jpeg", { client })).toEqual({ merchant: "Olive Garden", total: 6050, items: [] });
  });

  test("sends the image as a data URI with the mime type detected from its bytes", async () => {
    const client = clientReturning('{"merchant": null, "total": 10}');

    await extractReceipt(IMAGE, "image/png", { client });

    const content = client.chat.mock.calls[0][0].messages[0].content;
    expect(content[1]).toEqual({
      type: "image_url",
      imageUrl: { url: `data:image/png;base64,${IMAGE.toString("base64")}`, detail: "high" },
    });
  });

  test("tolerates a markdown fence around the JSON", async () => {
    const client = clientReturning('```json\n{"merchant": "Cafe", "total": 4}\n```');
    expect(await extractReceipt(IMAGE, "image/jpeg", { client })).toEqual({ merchant: "Cafe", total: 400, items: [] });
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
    expect(await extractReceipt(IMAGE, "image/jpeg", { client })).toEqual({ merchant: null, total: 1200, items: [] });
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

describe("extractReceipt - line items", () => {
  test("converts each item's dollar price to cents", async () => {
    const client = clientReturning(
      '{"merchant": "Bistro", "total": 45, "items": [{"description": "Burger", "amount": 12.5}, {"description": "Salad", "amount": 9}]}'
    );

    const result = await extractReceipt(IMAGE, "image/jpeg", { client });

    expect(result.items).toEqual([
      { description: "Burger", amount: 1250 },
      { description: "Salad", amount: 900 },
    ]);
  });

  test("drops unusable items but keeps the total and the good items", async () => {
    const client = clientReturning(
      JSON.stringify({
        merchant: "Bistro",
        total: 40,
        items: [
          { description: "Good", amount: 10 },
          { description: "Free", amount: 0 },
          { description: "Negative", amount: -3 },
          { description: "Text price", amount: "lots" },
          { description: "Phone number", amount: 5551234 },
          null,
          "not an object",
        ],
      })
    );

    const result = await extractReceipt(IMAGE, "image/jpeg", { client });

    expect(result.total).toBe(4000);
    expect(result.items).toEqual([{ description: "Good", amount: 1000 }]);
  });

  test("labels an item with no description", async () => {
    const client = clientReturning('{"merchant": null, "total": 20, "items": [{"amount": 5}]}');

    expect((await extractReceipt(IMAGE, "image/jpeg", { client })).items).toEqual([{ description: "Item", amount: 500 }]);
  });

  test("treats a missing or malformed items field as an empty list", async () => {
    for (const items of ['"items": "nope"', '"items": {"a": 1}', '"other": 1']) {
      const client = clientReturning(`{"merchant": "X", "total": 10, ${items}}`);
      expect((await extractReceipt(IMAGE, "image/jpeg", { client })).items).toEqual([]);
    }
  });

  test("caps how many items one response can return", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ description: `Item ${i}`, amount: 1 }));
    const client = clientReturning(JSON.stringify({ merchant: "X", total: 500, items: many }));

    expect((await extractReceipt(IMAGE, "image/jpeg", { client })).items).toHaveLength(60);
  });
});
