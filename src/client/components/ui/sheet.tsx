import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
function SheetContent({ className, children, side = "left", ...props }: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right" }) {
  return <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <SheetPrimitive.Content className={cn("bg-background fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out inset-y-0 h-full w-3/4 sm:max-w-sm border-r", side === "left" ? "left-0" : "right-0 border-l", className)} {...props}>
      <SheetPrimitive.Title className="sr-only">Menu</SheetPrimitive.Title>
      {children}
      <SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 hover:opacity-100 cursor-pointer"><XIcon className="size-4" /><span className="sr-only">Sluiten</span></SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>;
}
export { Sheet, SheetTrigger, SheetClose, SheetContent };
