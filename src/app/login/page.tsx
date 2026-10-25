/**
 * Pantalla de contraseña.
 *
 * Si no hay CRM_PASSWORD configurada no hay nada que validar: se vuelve a la
 * bandeja. Así el modo desarrollo no se traba en un login que no lleva a nada.
 */

import { redirect } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  if (!process.env.CRM_PASSWORD) redirect("/inbox");

  return (
    <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <MessagesSquare className="mx-auto h-8 w-8" />
          <h1 className="text-xl font-semibold">CRM Multicanal</h1>
          <p className="text-sm text-muted-foreground">
            Ingresá la contraseña para continuar.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
