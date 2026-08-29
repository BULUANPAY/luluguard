import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createRandomExportObject } from "./export-object";
import { ExportObjectForm } from "./export-object-form";

describe("ExportObjectForm", () => {
  it("submits the randomized default values for JSON preview", async () => {
    const values = createRandomExportObject(
      "森沐實業",
      new Date("2026-08-29"),
      () => 0.4,
    );
    const onPreview = vi.fn();
    const user = userEvent.setup();

    render(
      <ExportObjectForm
        initialValues={values}
        onPreview={onPreview}
        onRegenerate={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "產生 JSON 預覽" }));

    expect(onPreview).toHaveBeenCalledWith(values);
  });

  it("validates and submits the current values", async () => {
    const values = createRandomExportObject(
      "森沐實業",
      new Date("2026-08-29"),
      () => 0.4,
    );
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <ExportObjectForm
        initialValues={values}
        onPreview={vi.fn()}
        onRegenerate={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "送出出口物件" }));

    expect(onSubmit).toHaveBeenCalledWith(values);
  });

  it("adds another randomized goods item", async () => {
    const values = createRandomExportObject(
      "森沐實業",
      new Date("2026-08-29"),
      () => 0.4,
    );
    const onPreview = vi.fn();
    const user = userEvent.setup();

    render(
      <ExportObjectForm
        initialValues={values}
        onPreview={onPreview}
        onRegenerate={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "新增貨物" }));
    expect(screen.getByText("貨物明細（2）")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "產生 JSON 預覽" }));
    expect(onPreview.mock.calls[0]?.[0].goods).toHaveLength(2);
  });
});
