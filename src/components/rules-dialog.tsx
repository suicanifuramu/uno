import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { RulesContent } from "@/components/rules-content";

export function RulesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>ルール</DialogTitle>
        <div className="max-h-[65dvh] overflow-y-auto pr-2">
          <RulesContent />
        </div>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          閉じる
        </Button>
      </DialogContent>
    </Dialog>
  );
}
