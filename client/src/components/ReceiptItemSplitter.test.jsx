import { describe, test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReceiptItemSplitter from "./ReceiptItemSplitter";

const ME = { id: 1, name: "Alice" };
const BOB = { id: 2, name: "Bob" };

// Steak $40 + salad $10 = $50 of items, on a $60 receipt: $10 of tax and tip.
const receipt = {
  merchant: "Bistro",
  total: 6000,
  items: [
    { description: "Steak", amount: 4000 },
    { description: "Salad", amount: 1000 },
  ],
};

function renderSplitter(props = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  render(
    <ReceiptItemSplitter
      receipt={receipt}
      members={[ME, BOB]}
      currentUserId={ME.id}
      onApply={onApply}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onApply, onCancel };
}

const owes = () => within(screen.getByRole("list", { name: "Each person owes" }));

describe("ReceiptItemSplitter", () => {
  test("starts with every item shared by everyone", () => {
    renderSplitter();

    expect(screen.getByLabelText("Steak - You")).toBeChecked();
    expect(screen.getByLabelText("Steak - Bob")).toBeChecked();
    expect(screen.getByLabelText("Salad - You")).toBeChecked();
    // $60 shared evenly.
    expect(owes().getByText("You").nextSibling).toHaveTextContent("$30.00");
    expect(owes().getByText("Bob").nextSibling).toHaveTextContent("$30.00");
  });

  test("recomputes what each person owes as items are reassigned, tax and tip following the items", async () => {
    const user = userEvent.setup();
    renderSplitter();

    await user.click(screen.getByLabelText("Steak - Bob"));
    await user.click(screen.getByLabelText("Salad - You"));

    // Alice: steak ($40), Bob: salad ($10) -> 80/20 of the extra $10 as well.
    expect(owes().getByText("You").nextSibling).toHaveTextContent("$48.00");
    expect(owes().getByText("Bob").nextSibling).toHaveTextContent("$12.00");
  });

  test("shows the items, the tax and tip, and the total, and says how the gap is spread", () => {
    renderSplitter();

    expect(screen.getByText("Items").nextSibling).toHaveTextContent("$50.00");
    expect(screen.getByText("Tax, tip & other").nextSibling).toHaveTextContent("$10.00");
    expect(screen.getByText("Receipt total").nextSibling).toHaveTextContent("$60.00");
    expect(screen.getByText(/in proportion to what each person ordered/i)).toBeInTheDocument();
  });

  test("labels a negative gap as a discount", () => {
    renderSplitter({ receipt: { ...receipt, total: 4500 } });

    expect(screen.getByText("Discounts & adjustments").nextSibling).toHaveTextContent("-$5.00");
  });

  test("blocks applying while an item is assigned to nobody, and says so", async () => {
    const user = userEvent.setup();
    renderSplitter();

    await user.click(screen.getByLabelText("Salad - You"));
    await user.click(screen.getByLabelText("Salad - Bob"));

    expect(screen.getByText(/one item isn't assigned to anyone yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this split" })).toBeDisabled();
  });

  test("hands back exact per-person amounts that add up to the receipt total", async () => {
    const user = userEvent.setup();
    const { onApply } = renderSplitter();

    await user.click(screen.getByLabelText("Steak - Bob"));
    await user.click(screen.getByLabelText("Salad - You"));
    await user.click(screen.getByRole("button", { name: "Use this split" }));

    expect(onApply).toHaveBeenCalledWith({ shares: { 1: 4800, 2: 1200 }, total: 6000, merchant: "Bistro" });
  });

  test("cancel calls back without applying anything", async () => {
    const user = userEvent.setup();
    const { onApply, onCancel } = renderSplitter();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
