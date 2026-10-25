"use client";

/**
 * Header de la app.
 *
 * Existía el espacio reservado (la bandeja calcula su alto restando 3.5rem)
 * pero no el header: /settings solo se alcanzaba escribiendo la URL a mano.
 *
 * Se oculta en /login para no meter navegación en la pantalla de contraseña.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LogOut, MessagesSquare, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/inbox", label: "Bandeja", icon: Inbox },
  { href: "/settings", label: "Ajustes", icon: Settings },
];

export function AppHeader() {
  const pathname = usePathname();

  // En el login no hay navegación: es una pantalla de un solo propósito.
  if (pathname.startsWith("/login")) return null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4">
      <Link href="/inbox" className="flex items-center gap-2 font-semibold">
        <MessagesSquare className="h-5 w-5" />
        <span className="hidden sm:inline">CRM Multicanal</span>
      </Link>

      <nav className="flex flex-1 items-center gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Sin CRM_PASSWORD configurado, /api/auth/logout solo limpia una cookie
          que no existe y vuelve a la bandeja: es un no-op inocuo. */}
      <form action="/api/auth/logout" method="post">
        <Button type="submit" variant="ghost" size="sm" title="Salir">
          <LogOut className="h-4 w-4" />
          <span className="sr-only">Salir</span>
        </Button>
      </form>
    </header>
  );
}
