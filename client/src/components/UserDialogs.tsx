import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Eye, EyeOff, ShieldAlert, User as UserIcon } from "lucide-react";
import { insertUserSchema, type CreateUserRequest, type UpdateUserRequest } from "@shared/schema";
import { type UserResponse } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const createSchema = insertUserSchema.extend({
  username: z.string().min(2, "Username must be at least 2 characters"),
  password: z.string().min(4, "Password must be at least 4 characters"),
});

const updateSchema = insertUserSchema
  .partial()
  .extend({
    username: z.string().min(2, "Username must be at least 2 characters").optional(),
    password: z.string().min(4, "Password must be at least 4 characters").optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to update",
    path: ["username"],
  });

function fieldError(errors: Record<string, string | undefined>, field: string) {
  return errors[field];
}

export function CreateUserDialog({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (data: CreateUserRequest) => void;
  isPending: boolean;
}) {
  const [values, setValues] = useState<CreateUserRequest>({ username: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!open) {
      setValues({ username: "", password: "" });
      setErrors({});
      setShowPassword(false);
    }
  }, [open]);

  function submit() {
    const parsed = createSchema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "form";
        next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onCreate(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl p-0 overflow-hidden shadow-premium">
        <div className="p-6 md:p-7">
          <DialogHeader>
            <DialogTitle className="text-2xl">Create user</DialogTitle>
            <DialogDescription className="text-sm">
              Add a new account to the directory. Keep credentials secure.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="create-username">Username</Label>
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="create-username"
                  value={values.username}
                  onChange={(e) => setValues((p) => ({ ...p, username: e.target.value }))}
                  placeholder="e.g. ayse.demir"
                  className={cn(
                    "pl-10 rounded-xl border-2 bg-background/60",
                    "focus:ring-4 focus:ring-ring/10 focus:border-ring transition-all duration-200",
                  )}
                  data-testid="input-create-username"
                />
              </div>
              {fieldError(errors, "username") ? (
                <p className="text-xs text-destructive" data-testid="text-error-username">{errors.username}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="create-password">Password</Label>
              <div className="relative">
                <ShieldAlert className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="create-password"
                  type={showPassword ? "text" : "password"}
                  value={values.password}
                  onChange={(e) => setValues((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Minimum 4 characters"
                  className={cn(
                    "pl-10 pr-10 rounded-xl border-2 bg-background/60",
                    "focus:ring-4 focus:ring-ring/10 focus:border-ring transition-all duration-200",
                  )}
                  data-testid="input-create-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className={cn(
                    "absolute right-2.5 top-1/2 -translate-y-1/2",
                    "h-8 w-8 rounded-lg grid place-items-center",
                    "text-muted-foreground",
                    "transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/15",
                  )}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  data-testid="button-toggle-password-create"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldError(errors, "password") ? (
                <p className="text-xs text-destructive" data-testid="text-error-password">{errors.password}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Tip: Use a passphrase, not a single word.
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 md:px-7 md:pb-7 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
            disabled={isPending}
            data-testid="button-cancel-create"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={isPending}
            className={cn(
              "rounded-xl shadow-premium",
              "bg-gradient-to-r from-primary to-primary/85",
              "transition-all duration-200",
            )}
            data-testid="button-submit-create"
          >
            {isPending ? "Creating..." : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditUserDialog({
  open,
  onOpenChange,
  user,
  onSave,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: UserResponse | null;
  onSave: (updates: UpdateUserRequest) => void;
  isPending: boolean;
}) {
  const initial = useMemo<UpdateUserRequest>(() => ({}), [user?.id]);
  const [values, setValues] = useState<UpdateUserRequest>(initial);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (open) {
      setValues({});
      setErrors({});
      setShowPassword(false);
    }
  }, [open, user?.id]);

  function submit() {
    const parsed = updateSchema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "form";
        next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onSave(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl p-0 overflow-hidden shadow-premium">
        <div className="p-6 md:p-7">
          <DialogHeader>
            <DialogTitle className="text-2xl">Edit user</DialogTitle>
            <DialogDescription className="text-sm">
              Updating <span className="font-semibold text-foreground">{user?.username ?? "..."}</span>.
              Send only fields you want to change.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-username">Username</Label>
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="edit-username"
                  value={values.username ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, username: e.target.value || undefined }))}
                  placeholder={user?.username ?? "username"}
                  className={cn(
                    "pl-10 rounded-xl border-2 bg-background/60",
                    "focus:ring-4 focus:ring-ring/10 focus:border-ring transition-all duration-200",
                  )}
                  data-testid="input-edit-username"
                />
              </div>
              {fieldError(errors, "username") ? (
                <p className="text-xs text-destructive">{errors.username}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Leave empty to keep unchanged.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-password">Password</Label>
              <div className="relative">
                <ShieldAlert className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="edit-password"
                  type={showPassword ? "text" : "password"}
                  value={values.password ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, password: e.target.value || undefined }))}
                  placeholder="New password (optional)"
                  className={cn(
                    "pl-10 pr-10 rounded-xl border-2 bg-background/60",
                    "focus:ring-4 focus:ring-ring/10 focus:border-ring transition-all duration-200",
                  )}
                  data-testid="input-edit-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className={cn(
                    "absolute right-2.5 top-1/2 -translate-y-1/2",
                    "h-8 w-8 rounded-lg grid place-items-center",
                    "text-muted-foreground",
                    "transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/15",
                  )}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  data-testid="button-toggle-password-edit"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldError(errors, "password") ? (
                <p className="text-xs text-destructive">{errors.password}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Leave empty to keep unchanged.
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 md:px-7 md:pb-7 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
            disabled={isPending}
            data-testid="button-cancel-edit"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={isPending || !user?.id}
            className={cn(
              "rounded-xl shadow-premium",
              "bg-gradient-to-r from-primary to-primary/85",
              "transition-all duration-200",
            )}
            data-testid="button-submit-edit"
          >
            {isPending ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteUserDialog({
  open,
  onOpenChange,
  user,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: UserResponse | null;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl p-0 overflow-hidden shadow-premium">
        <div className="p-6 md:p-7">
          <DialogHeader>
            <DialogTitle className="text-2xl">Delete user</DialogTitle>
            <DialogDescription className="text-sm">
              This action cannot be undone.{" "}
              <span className="font-semibold text-foreground">
                {user?.username ?? "This user"}
              </span>{" "}
              will be permanently removed.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 rounded-2xl border bg-destructive/5 p-4">
            <p className="text-sm text-foreground">
              Confirm deletion to proceed.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tip: If you're unsure, edit username instead.
            </p>
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 md:px-7 md:pb-7 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
            disabled={isPending}
            data-testid="button-cancel-delete"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending || !user?.id}
            className={cn(
              "rounded-xl shadow-premium",
              "transition-all duration-200",
            )}
            data-testid="button-confirm-delete"
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
