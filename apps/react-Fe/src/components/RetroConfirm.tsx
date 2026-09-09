import { Dialog, Transition } from "@headlessui/react";
import { Fragment } from "react";
import Button from "./Button";

const RetroConfirm: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  severity?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  message,
  confirmText = "Confirm",
  severity = "danger",
  onConfirm,
  onCancel,
}) => {
  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[70]" onClose={onCancel}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center sm:items-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative w-full max-w-sm rounded-sm border-[3px] border-ink bg-paper p-6 text-left shadow-[8px_8px_0_0_var(--color-ink)]">
                <Dialog.Title className="text-lg font-extrabold uppercase tracking-wide text-ink">
                  {title}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm font-medium text-ink/70">
                  {message}
                </Dialog.Description>
                <div className="mt-6 grid grid-cols-2 gap-4">
                  <Button severity="secondary" fullWidth onClick={onCancel}>
                    Cancel
                  </Button>
                  <Button severity={severity} fullWidth onClick={onConfirm}>
                    {confirmText}
                  </Button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
};

export default RetroConfirm;