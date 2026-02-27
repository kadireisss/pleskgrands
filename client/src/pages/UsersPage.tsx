import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Plus, RefreshCw, Users as UsersIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Toolbar, type SortKey } from "@/components/Toolbar";
import { StatPill } from "@/components/StatPill";
import { CreateUserDialog, DeleteUserDialog, EditUserDialog } from "@/components/UserDialogs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCreateUser, useDeleteUser, useUpdateUser, useUsers } from "@/hooks/use-users";
import type { UserResponse } from "@shared/routes";

const PAGE_SIZE = 8;

function initials(username?: string) {
  const u = (username ?? "").trim();
  if (!u) return "--";
  const parts = u.split(/[._\s-]+/g).filter(Boolean);
  const a = parts[0]?.[0] ?? u[0];
  const b = parts[1]?.[0] ?? u[1] ?? "";
  return (a + b).toUpperCase();
}

export default function UsersPage() {
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch, isFetching } = useUsers(search);

  const users = data ?? [];

  const sorted = useMemo(() => {
    const copy = [...users];
    switch (sort) {
      case "username-asc":
        copy.sort((a, b) => a.username.localeCompare(b.username));
        break;
      case "username-desc":
        copy.sort((a, b) => b.username.localeCompare(a.username));
        break;
      case "newest":
        copy.sort((a, b) => (a.id < b.id ? 1 : -1));
        break;
      case "oldest":
        copy.sort((a, b) => (a.id > b.id ? 1 : -1));
        break;
      default:
        break;
    }
    return copy;
  }, [users, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = useMemo(() => {
    const start = (pageSafe - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, pageSafe]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [active, setActive] = useState<UserResponse | null>(null);

  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();

  const headerActions = (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
      <div className="flex flex-wrap gap-2">
        <StatPill label="Total" value={users.length} tone="primary" />
        <StatPill label="Showing" value={paged.length} tone="neutral" />
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => refetch()}
          className={cn(
            "rounded-xl border-2",
            "bg-background/60",
            "transition-all duration-200",
          )}
          data-testid="button-refresh-users"
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isFetching ? "animate-spin" : "")} />
          Refresh
        </Button>

        <Button
          onClick={() => setCreateOpen(true)}
          className={cn(
            "rounded-xl shadow-premium",
            "bg-gradient-to-r from-primary to-primary/85",
            "transition-all duration-200",
          )}
          data-testid="button-new-user"
        >
          <Plus className="h-4 w-4 mr-2" />
          New user
        </Button>
      </div>
    </div>
  );

  return (
    <AppShell
      title="Users"
      subtitle="A clean, minimal directory. Create, update, search and remove users with typed API validation."
      actions={headerActions}
    >
      <div className="grid gap-5">
        <Toolbar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          sort={sort}
          onSortChange={(s) => setSort(s)}
          onClear={() => {
            setSearch("");
            setPage(1);
          }}
        />

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card
                key={i}
                className={cn(
                  "rounded-3xl p-5 border bg-card/70",
                  "shadow-sm animate-pulse",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-2xl bg-muted" />
                    <div className="space-y-2">
                      <div className="h-4 w-40 bg-muted rounded-lg" />
                      <div className="h-3 w-28 bg-muted rounded-lg" />
                    </div>
                  </div>
                  <div className="h-9 w-9 rounded-xl bg-muted" />
                </div>
                <div className="mt-4 h-10 bg-muted rounded-2xl" />
              </Card>
            ))}
          </div>
        ) : error ? (
          <Card className="rounded-3xl p-6 md:p-8 shadow-premium border bg-card/80">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="text-xl">Couldn't load users</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {String((error as Error)?.message ?? "Unknown error")}
                </p>
              </div>
              <Button
                onClick={() => refetch()}
                className={cn(
                  "rounded-xl shadow-premium",
                  "bg-gradient-to-r from-primary to-primary/85",
                )}
                data-testid="button-retry"
              >
                Retry
              </Button>
            </div>
          </Card>
        ) : users.length === 0 ? (
          <Card className="rounded-3xl p-7 md:p-10 shadow-premium border bg-card/80">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-2xl grid place-items-center bg-gradient-to-br from-primary/12 to-accent/10 border">
                  <UsersIcon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-2xl tracking-tight" data-testid="text-empty-state">No users yet</h3>
                  <p className="mt-1 text-sm md:text-base text-muted-foreground max-w-xl">
                    Create your first user to populate the directory.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => setCreateOpen(true)}
                className={cn(
                  "rounded-xl shadow-premium",
                  "bg-gradient-to-r from-primary to-primary/85",
                  "transition-all duration-200",
                )}
                data-testid="button-create-first"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create user
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="grid-users">
              {paged.map((u, idx) => (
                <Card
                  key={u.id}
                  className={cn(
                    "rounded-3xl p-5 bg-card/80 border shadow-sm",
                    "transition-all duration-300",
                    "rise-in",
                    idx % 3 === 0 ? "stagger-1" : idx % 3 === 1 ? "stagger-2" : "stagger-3",
                  )}
                  data-testid={`card-user-${u.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "h-11 w-11 rounded-2xl shrink-0 grid place-items-center",
                          "bg-gradient-to-br from-primary/14 to-accent/10 border",
                          "text-primary font-semibold",
                        )}
                        aria-hidden="true"
                      >
                        {initials(u.username)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate" data-testid={`text-username-${u.id}`}>{u.username}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          ID: {u.id}
                        </div>
                      </div>
                    </div>

                    <Link
                      href={`/users/${u.id}`}
                      className={cn(
                        "h-9 w-9 rounded-xl grid place-items-center",
                        "border bg-background/60",
                        "text-muted-foreground",
                        "transition-all duration-200 focus-ring",
                      )}
                      aria-label={`Open ${u.username}`}
                      data-testid={`link-user-${u.id}`}
                    >
                      <span className="text-sm font-semibold">&#8599;</span>
                    </Link>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setActive(u);
                        setEditOpen(true);
                      }}
                      className="rounded-xl border-2 flex-1"
                      data-testid={`button-edit-${u.id}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setActive(u);
                        setDeleteOpen(true);
                      }}
                      className="rounded-xl flex-1"
                      data-testid={`button-delete-${u.id}`}
                    >
                      Delete
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <div className="text-sm text-muted-foreground" data-testid="text-pagination">
                  Page <span className="font-semibold text-foreground">{pageSafe}</span> of{" "}
                  <span className="font-semibold text-foreground">{totalPages}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="rounded-xl border-2"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={pageSafe <= 1}
                    data-testid="button-prev-page"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl border-2"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={pageSafe >= totalPages}
                    data-testid="button-next-page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        isPending={createMutation.isPending}
        onCreate={(payload) => {
          createMutation.mutate(payload, {
            onSuccess: () => {
              setCreateOpen(false);
              toast({
                title: "User created",
                description: "The directory has been updated.",
              });
            },
            onError: (e) => {
              toast({
                title: "Create failed",
                description: String((e as Error)?.message ?? "Unknown error"),
                variant: "destructive",
              });
            },
          });
        }}
      />

      <EditUserDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        user={active}
        isPending={updateMutation.isPending}
        onSave={(updates) => {
          if (!active?.id) return;
          updateMutation.mutate(
            { id: active.id, updates },
            {
              onSuccess: () => {
                setEditOpen(false);
                toast({
                  title: "User updated",
                  description: "Changes saved successfully.",
                });
              },
              onError: (e) => {
                toast({
                  title: "Update failed",
                  description: String((e as Error)?.message ?? "Unknown error"),
                  variant: "destructive",
                });
              },
            },
          );
        }}
      />

      <DeleteUserDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        user={active}
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          if (!active?.id) return;
          deleteMutation.mutate(active.id, {
            onSuccess: () => {
              setDeleteOpen(false);
              toast({
                title: "User deleted",
                description: "Removed from the directory.",
              });
            },
            onError: (e) => {
              toast({
                title: "Delete failed",
                description: String((e as Error)?.message ?? "Unknown error"),
                variant: "destructive",
              });
            },
          });
        }}
      />
    </AppShell>
  );
}
