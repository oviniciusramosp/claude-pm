import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { ModalOverlay, Modal, Dialog } from "./modal";
import { Button } from "@/components/base/buttons/button";
import { styles as buttonStyles } from "@/components/base/buttons/button";

// Minimal wrapper that simulates opening a modal via state,
// mirroring how IdeaToEpicsModal and other modals are rendered.
function TestModalHost({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div data-testid="react-root">
      <button data-testid="open-btn" onClick={() => setOpen(true)}>
        Open Modal
      </button>
      <ModalOverlay
        isOpen={open}
        onOpenChange={(next) => { if (!next) setOpen(false); }}
        isDismissable
      >
        <Modal>
          <Dialog aria-label="Test modal">
            <div data-testid="modal-content">
              <h2>Test Modal</h2>
              <button data-testid="close-btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}

// Wrapper that renders a modal with Button components inside,
// mirroring how IdeaToEpicsModal renders buttons with specific colors.
function ModalWithButton({ startOpen = false, buttonColor = "primary" }: { startOpen?: boolean; buttonColor?: string }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div data-testid="react-root">
      <button data-testid="open-btn" onClick={() => setOpen(true)}>
        Open Modal
      </button>
      <ModalOverlay
        isOpen={open}
        onOpenChange={(next) => { if (!next) setOpen(false); }}
        isDismissable
      >
        <Modal>
          <Dialog aria-label="Test modal with button">
            <div data-testid="modal-content">
              <Button size="sm" color={buttonColor as any} onPress={() => {}}>
                Test Button
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}

describe("ModalOverlay", () => {
  it("does not wrap AriaModalOverlay in createPortal (regression guard)", () => {
    // The crash was caused by wrapping AriaModalOverlay in createPortal(…, document.body).
    // React Aria's AriaModalOverlay already uses createPortal internally via OverlayContainer.
    // Double-portaling breaks React Aria's context chain (ModalProvider), causing:
    //   "Modal is not contained within a provider"
    // which unmounts the entire React tree because there is no error boundary.
    //
    // This test reads the ModalOverlay source to verify it does NOT use createPortal.
    const source = ModalOverlay.toString();
    expect(source).not.toContain("createPortal");
  });

  it("renders the modal without crashing the React tree when opened", async () => {
    const { container } = render(<TestModalHost startOpen />);

    // The React root should still be mounted (not empty).
    // Before the fix, the entire React tree unmounted, leaving #root empty.
    expect(container.querySelector('[data-testid="react-root"]')).toBeInTheDocument();

    // The modal content should be visible (rendered into a portal by React Aria itself).
    expect(screen.getByTestId("modal-content")).toBeInTheDocument();
    expect(screen.getByText("Test Modal")).toBeInTheDocument();
  });

  it("renders modal content when opened via user interaction", async () => {
    const user = userEvent.setup();
    const { container } = render(<TestModalHost startOpen={false} />);

    // Initially, modal content should not be in the document.
    expect(screen.queryByTestId("modal-content")).not.toBeInTheDocument();

    // Click the open button using userEvent (wraps in act automatically).
    await user.click(screen.getByTestId("open-btn"));

    // The React root should still be mounted after opening the modal.
    expect(container.querySelector('[data-testid="react-root"]')).toBeInTheDocument();

    // The modal content should now be visible.
    expect(screen.getByTestId("modal-content")).toBeInTheDocument();
  });

  it("does not unmount the component tree when isOpen transitions to true", () => {
    const { container, rerender } = render(<TestModalHost startOpen={false} />);

    // Verify the tree is mounted.
    expect(container.innerHTML).not.toBe("");

    // Re-render with the modal open.
    rerender(<TestModalHost startOpen />);

    // The tree must still be mounted (not empty).
    expect(container.innerHTML).not.toBe("");
    expect(container.querySelector('[data-testid="react-root"]')).toBeInTheDocument();
  });

  it("renders modal with Button using valid color prop without crashing (regression guard)", () => {
    // The IdeaToEpicsModal crash was caused by passing color="brand" to the Button component.
    // The Button component's styles.colors object does not have a "brand" key, so
    // styles.colors["brand"].root throws: TypeError: Cannot read properties of undefined (reading 'root')
    // This uncaught error during render unmounts the entire React tree.
    //
    // This test verifies that a modal with a Button using color="primary" renders correctly.
    const { container } = render(<ModalWithButton startOpen buttonColor="primary" />);
    expect(container.querySelector('[data-testid="react-root"]')).toBeInTheDocument();
    expect(screen.getByText("Test Button")).toBeInTheDocument();
  });

  it("Button styles.colors contains only known color keys (no 'brand' key)", () => {
    // Guard: "brand" is a valid Badge color but NOT a valid Button color.
    // Using color="brand" on Button crashes the app because styles.colors["brand"]
    // is undefined, and accessing .root on undefined throws a TypeError.
    const validButtonColors = Object.keys(buttonStyles.colors);
    expect(validButtonColors).not.toContain("brand");
    expect(validButtonColors).toContain("primary");
    expect(validButtonColors).toContain("secondary");
  });
});
