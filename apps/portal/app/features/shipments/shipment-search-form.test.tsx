import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShipmentSearchForm } from "./shipment-search-form";

describe("ShipmentSearchForm", () => {
  it("submits a trimmed search value", async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<ShipmentSearchForm onSearch={onSearch} />);

    await user.type(screen.getByLabelText("搜尋貨件"), "  LG-001  ");
    await user.click(screen.getByRole("button", { name: "搜尋" }));

    expect(onSearch).toHaveBeenCalledWith("LG-001");
  });
});
