import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Users, Server, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppShell({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen surface grain">
      <div className="relative z-10">
        <header className="sticky top-0 z-20 border-b bg-background/70 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="h-16 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl shadow-premium grid place-items-center bg-gradient-to-br from-primary/12 to-accent/10 border">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="leading-tight">
                  <div className="font-display text-lg tracking-tight">
                    Grand Users
                  </div>
                  <div className="text-xs text-muted-foreground -mt-0.5">
                    admin panel
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <nav className="hidden sm:flex items-center gap-1">
                  <Link
                    href="/"
                    className={cn(
                      "px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-200",
                      location === "/"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground",
                    )}
                    data-testid="nav-users"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Users
                    </span>
                  </Link>
                  <Link
                    href="/admin"
                    className={cn(
                      "px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-200",
                      location === "/admin"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground",
                    )}
                    data-testid="nav-admin"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Server className="h-4 w-4" />
                      Proxy
                    </span>
                  </Link>
                </nav>

                <div className="h-9 w-px bg-border mx-1 hidden sm:block" />

                <ThemeToggle />
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <section className="pt-8 pb-6 md:pt-10 md:pb-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
              <div className="rise-in">
                <h1 className="text-3xl md:text-4xl font-display tracking-tight" data-testid="text-page-title">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-2 text-sm md:text-base text-muted-foreground max-w-2xl">
                    {subtitle}
                  </p>
                ) : null}
              </div>
              {actions ? <div className="fade-in">{actions}</div> : null}
            </div>
          </section>

          <section className="pb-16">{children}</section>
        </main>

        <footer className="border-t">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                Grand Users Admin Panel
              </div>
              <div className="flex items-center gap-2">
                <Link href="/" className="text-sm font-semibold text-foreground" data-testid="link-footer-home">
                  Users
                </Link>
                <span className="text-muted-foreground">|</span>
                <Link href="/admin" className="text-sm font-semibold text-foreground" data-testid="link-footer-admin">
                  Proxy
                </Link>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
