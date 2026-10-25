import Link from "next/link";
import { Inbox, Settings } from "lucide-react";

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <nav className="flex h-14 shrink-0 items-center gap-1 border-b px-4">
        <Link
          href="/inbox"
          className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <Inbox className="h-4 w-4" />
          Bandeja
        </Link>
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Ajustes
        </Link>
      </nav>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
